/**
 * How long one service's deployment is followed by default. A first build
 * takes a few minutes; twenty leaves room for a queue without letting a stuck
 * deployment hang a CI job for good.
 */
export const DEFAULT_DEPLOY_TIMEOUT_MINUTES = 20;
