import { IconCheck, IconX } from '@/components/ui/icons';
import { linkStateOf, nodeStateOf, type StepFlowState } from './stepFlowModel';
import styles from './StepFlow.module.scss';

export interface StepFlowStep {
  id: string;
  label: string;
}

export type { StepFlowState } from './stepFlowModel';

export interface StepFlowProps {
  steps: StepFlowStep[];
  /** Index of the step under way (or finished, or failed); -1 before anything starts. */
  current: number;
  state: StepFlowState;
  /** Accessible name of the list. */
  label: string;
}

/**
 * A short sequence of steps (e.g. browser → sign in → account added). The step under way is
 * indigo and a dot travels toward the next one while it waits; finished steps get a check, a
 * failed one a red cross. Reduced motion keeps the states and drops the dot. The list carries the
 * meaning for assistive technology (`aria-current="step"`); the drawing is decorative.
 */
export function StepFlow({ steps, current, state, label }: StepFlowProps) {
  return (
    <ol className={styles.flow} aria-label={label} data-state={state}>
      {steps.map((step, index) => {
        const node = nodeStateOf(index, current, state);
        const link = index < steps.length - 1 ? linkStateOf(index, current, state) : null;
        return (
          <li
            key={step.id}
            className={styles.step}
            data-node={node}
            aria-current={node === 'current' || node === 'failed' ? 'step' : undefined}
          >
            <span className={styles.node} aria-hidden="true">
              {node === 'done' ? (
                <IconCheck size={12} />
              ) : node === 'failed' ? (
                <IconX size={12} />
              ) : (
                <span className={styles.core} />
              )}
            </span>
            <span className={styles.label}>{step.label}</span>
            {link ? (
              <span className={styles.connector} data-link={link} aria-hidden="true">
                {link === 'live' ? <span className={styles.dot} /> : null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
