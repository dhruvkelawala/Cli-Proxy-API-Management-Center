/** StepFlow's pure state rules, kept apart from the component (React-free, testable). */

export type StepFlowState = 'idle' | 'active' | 'done' | 'failed';

type NodeState = 'idle' | 'done' | 'current' | 'failed';

export const nodeStateOf = (index: number, current: number, state: StepFlowState): NodeState => {
  if (state === 'idle' || current < 0) return 'idle';
  if (index < current) return 'done';
  if (index > current) return 'idle';
  if (state === 'done') return 'done';
  if (state === 'failed') return 'failed';
  return 'current';
};

/** A link carries a travelling dot only out of the step that is waiting. */
export const linkStateOf = (index: number, current: number, state: StepFlowState) => {
  if (state === 'idle' || current < 0) return 'idle';
  if (index < current) return 'done';
  if (index === current && state === 'active') return 'live';
  if (index === current && state === 'done') return 'done';
  return 'idle';
};
