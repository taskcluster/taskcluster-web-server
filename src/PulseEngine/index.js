import Debug from 'debug';
import { Client } from 'taskcluster-lib-pulse';
import { slugid } from 'taskcluster-client';
import flatten from 'arr-flatten';
import { serialize } from 'async-decorators';
import AsyncIterator from './AsyncIterator';

const debug = Debug('PulseEngine');

class Subscription {
  constructor({ subscriptionId, onMessage, eventName, triggers }) {
    this.subscriptionId = subscriptionId;
    this.onMessage = onMessage;
    this.eventName = eventName;
    this.triggers = triggers;

    // state tracking for reconciliation
    this.listening = false;
    this.unsubscribed = false;
  }

  /**
   * Reset this subscription to its non-listening state
   */
  reset() {
    this.listening = false;
  }

  /**
   * Flag this subscription as needing unsubscription at the next
   * reconciliation
   */
  unsubscribe() {
    this.unsubscribed = true;
  }

  /**
   * Reconcile the AMQP state with this subscription's state.
   */
  async reconcile(client, connection, channel) {
    const { subscriptionId, listening, unsubscribed } = this;
    const queueName = client.fullObjectName('queue', subscriptionId);

    if (listening && unsubscribed) {
      debug(`Unbinding subscription ${subscriptionId}`);
      await channel.cancel(this.consumerTag);
      await channel.deleteQueue(queueName);
      this.listening = false;
    } else if (!listening && !unsubscribed) {
      debug(`Binding subscription ${subscriptionId}`);
      const { eventName, onMessage, triggers } = this;

      await channel.assertQueue(queueName, {
        exclusive: false,
        durable: true,
        autoDelete: true,
      });

      await Promise.all(
        flatten(
          Object.entries(triggers).map(([routingKeyPattern, exchanges]) =>
            exchanges.map(exchange =>
              channel.bindQueue(queueName, exchange, routingKeyPattern)
            )
          )
        )
      );

      const { consumerTag } = await channel.consume(queueName, message => {
        const payload = JSON.parse(message.content.toString('utf8'));

        onMessage({ [eventName]: payload });
      });

      this.consumerTag = consumerTag;
      this.listening = true;
    }
  }

  /**
   * If true, this subscription is complete and can be dropped from the list.
   */
  get garbage() {
    return this.unsubscribed && !this.listening;
  }
}

export default class PulseEngine {
  /* Operation:
   *
   * Each subscription gets one queue (named after the subscriptionId), with
   * a binding for each item in `triggers`. We then consume from that queue.
   * All queues are ephemeral, meaning they will go away when this service
   * restarts or the connection recycles. We automatically re-bind on
   * connection recycles, and rely on the caller to re-subscribe on service
   * restart. */

  constructor({ connection, monitor }) {
    this.monitor = monitor;
    // TODO: use tc creds instead
    this.client = new Client({ monitor, ...connection });

    this.subscriptions = new Map();

    this.reset();
    this.client.onConnected(conn => this.connected(conn));
  }

  reset() {
    this.connection = null;
    this.channel = null;
  }

  connected(connection) {
    debug('Connected to AMQP server');

    // reset everything and reconcile
    Array.from(this.subscriptions.values()).forEach(sub => sub.reset());
    this.reset();
    this.connection = connection;
    this.reconcileSubscriptions();
  }

  subscribe({ eventName, triggers }, onMessage) {
    const subscriptionId = slugid();

    this.subscriptions.set(
      subscriptionId,
      new Subscription({
        subscriptionId,
        onMessage,
        eventName,
        triggers,
      })
    );
    this.reconcileSubscriptions();

    return subscriptionId;
  }

  unsubscribe(subscriptionId) {
    const sub = this.subscriptions.get(subscriptionId);

    if (sub) {
      sub.unsubscribe();
    }

    this.reconcileSubscriptions();
  }

  reconcileSubscriptions() {
    // handle async errors from reconciliation by reporting them
    this.innerReconcileSubscriptions().catch(err => {
      // if there's a connection active, signal that it has failed..
      if (this.connection) {
        this.connection.failed();
        this.reset();
      }

      // report the error and move on..
      this.monitor.reportError(err);
    });
  }

  @serialize
  async innerReconcileSubscriptions() {
    debug('Reconciling subscriptions');

    const { connection, client } = this;

    // if there's no connection, there's nothing to do; reconciliation
    // will occur again on the next connection
    if (!connection) {
      return;
    }

    if (!this.channel) {
      this.channel = await connection.amqp.createChannel();
    }

    const { channel } = this;

    await Promise.all(
      Array.from(this.subscriptions.values()).map(sub =>
        sub.reconcile(client, connection, channel)
      )
    );

    // clean up any garbage
    Array.from(this.subscriptions.values())
      .filter(sub => sub.garbage)
      .forEach(sub => this.subscriptions.delete(sub.subscriptionId));
  }

  asyncIterator(eventName, triggers) {
    return new AsyncIterator(this, { eventName, triggers });
  }
}
