import DataLoader from 'dataloader';
import sift from 'sift';
import { isNil } from 'ramda';
import ConnectionLoader from '../ConnectionLoader';
import Artifact from '../entities/Artifact';
import Artifacts from '../entities/Artifacts';

export default ({ queue }, isAuthed) => {
  const withUrl = ({ method, taskId, artifact, runId }) => {
    const hasRunId = !isNil(runId);

    if (isAuthed) {
      return {
        ...artifact,
        url: hasRunId
          ? queue.buildSignedUrl(method, taskId, runId, artifact.name)
          : queue.buildSignedUrl(method, taskId, artifact.name),
      };
    }

    return {
      ...artifact,
      url: hasRunId
        ? queue.buildUrl(method, taskId, runId, artifact.name)
        : queue.buildUrl(method, taskId, artifact.name),
    };
  };

  const artifact = new DataLoader(queries =>
    Promise.all(
      queries.map(async ({ taskId, runId, name }) => {
        const artifact = await queue.getArtifact(taskId, runId, name);

        return new Artifact(
          taskId,
          withUrl(queue.getArtifact, taskId, artifact, runId),
          runId
        );
      })
    )
  );
  const artifacts = new ConnectionLoader(
    async ({ taskId, runId, filter, options }) => {
      const raw = await queue.listArtifacts(taskId, runId, options);
      const withUrls = raw.artifacts.map(artifact =>
        withUrl({
          method: queue.getArtifact,
          taskId,
          artifact,
          runId,
        })
      );
      const artifacts = filter ? sift(filter, withUrls) : withUrls;

      return new Artifacts(taskId, runId, { ...raw, artifacts });
    }
  );
  const latestArtifacts = new ConnectionLoader(
    async ({ taskId, filter, options }) => {
      const raw = await queue.listLatestArtifacts(taskId, options);
      const withUrls = raw.artifacts.map(artifact =>
        withUrl({
          method: queue.getLatestArtifact,
          taskId,
          artifact,
        })
      );
      const artifacts = filter ? sift(filter, withUrls) : withUrls;

      return new Artifacts(taskId, null, { ...raw, artifacts });
    }
  );

  return {
    artifact,
    artifacts,
    latestArtifacts,
  };
};
