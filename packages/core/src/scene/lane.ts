// Scenes take turns warming up. When several start together (a carousel),
// compiling one at a time gets each its first frame sooner than compiling
// all of them at once. Scenes being drawn go first and never wait for paused ones.

/** What the lane needs from a scene's warm-up. */
export interface LaneMember {
  /** Whether the scene is paused. */
  readonly paused: boolean;
  /** Whether a warm-up is scheduled and has not started yet. */
  readonly pending: boolean;
  /** Starts the warm-up, or queues it in the lane if it may not run yet. */
  run(): Promise<void>;
}

/** Scenes attached to a canvas. */
export const attached = new Set<LaneMember>();
/**
 * Scenes drawing their content. While one shows, other scenes compile in
 * short slices so it does not stall.
 */
export const showing = new Set<LaneMember>();
/** Scenes compiling now. */
export const running = new Set<LaneMember>();
/** Scenes waiting for their turn. */
export const waiting = new Set<LaneMember>();

/**
 * Whether `member` may start its warm-up now. A drawn scene may run unless
 * another drawn scene is compiling. A paused scene may run only when no
 * other scene is compiling and no drawn scene is about to.
 */
export const mayWarmUp = (member: LaneMember) => {
  const others = [...running].filter((other) => other !== member);
  if (!member.paused) return others.every((other) => other.paused);
  if (others.length > 0) return false;
  for (const other of attached)
    if (other !== member && !other.paused && (other.pending || waiting.has(other))) return false;
  return true;
};

/** Starts the waiting warm-ups that may run now, drawn scenes first. */
export const nextInLane = () => {
  const queue = [...waiting].sort((a, b) => Number(a.paused) - Number(b.paused));
  for (const member of queue) if (mayWarmUp(member)) void member.run();
};

/** Whether a scene other than `member` is drawing its content. */
export const othersShowing = (member: LaneMember) => [...showing].some((other) => other !== member);

/** Removes `member` from the lane, then lets the next warm-ups start. */
export const leaveLane = (member: LaneMember) => {
  showing.delete(member);
  attached.delete(member);
  waiting.delete(member);
  running.delete(member);
  nextInLane();
};
