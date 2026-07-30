/**
 * Compatibility entrypoint for the versioned data-truth contracts.
 *
 * New code should import from `lib/truth/v1`. Keeping this module means the
 * foundation PR's import path remains valid while the runtime schemas become
 * the source of truth for TypeScript types.
 */
export * from "./v1/constants";
export * from "./v1/schemas";
