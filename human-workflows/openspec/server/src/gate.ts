/** A flag that is set for exactly as long as one piece of async work runs. */
export class Gate {
  private holding = false;

  get held(): boolean {
    return this.holding;
  }

  /**
   * Runs `work` with the gate held. Check `held` just before calling this, with no await in between,
   * so no other call can pass the same check before the gate closes.
   */
  async hold<T>(work: () => Promise<T>): Promise<T> {
    this.holding = true;
    try {
      return await work();
    } finally {
      this.holding = false;
    }
  }
}
