// Motion runtime: recorded Jumper policy clips (public/motions) driving any CrabRig.
export { createMotionController, type MotionControllerImpl } from './controller';
export { MotionLibrary, getMotionLibrary, LOCOMOTION_CLIPS, type ClipId, type ClipIndexEntry, type LoadedClip } from './library';
export { HOME_Q, STAND_HEIGHT } from './pose';
export type { MotionClip, MotionController, MotionId, MotionPlayOptions } from './types';
