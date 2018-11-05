export default class Artifact {
  constructor(taskId, data, runId) {
    Object.assign(this, data);
    this.taskId = taskId;
    this.isPublic = /^public\//.test(this.name);
    this.isLog = /\/logs\//.test(this.name);

    if (runId) {
      this.runId = runId;
    }
  }
}
