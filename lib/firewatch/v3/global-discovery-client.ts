import type {
  ExploreDiscoveryRequest,
  ExploreDiscoveryResponse,
  NearbyDiscoveryRequest,
  NearbyDiscoveryResponse,
} from "./discovery-contracts";

export type GlobalDiscoveryTransport =
  | "live"
  | "revalidated-cache"
  | "cache-fallback"
  | "fixture";

/**
 * The transport result remains distinct from discovery coverage. In
 * particular, an HTTP-success response may still carry partial, stale, or
 * unavailable domain coverage and must not be promoted to valid-empty.
 */
export type GlobalDiscoveryClientResult<Response> =
  | Readonly<{
      kind: "snapshot";
      transport: GlobalDiscoveryTransport;
      data: Response;
    }>
  | Readonly<{
      kind: "invalid-request";
      retryable: false;
    }>
  | Readonly<{
      kind: "cancelled";
      retryable: false;
    }>
  | Readonly<{
      kind: "unavailable";
      retryable: true;
    }>
  | Readonly<{
      kind: "invalid-response";
      retryable: true;
    }>;

export type GlobalDiscoveryRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

/**
 * Browser-facing persisted-read boundary. Implementations validate requests
 * and responses with the shared schemas, perform no provider collection, do
 * not retry internally, and never reuse a snapshot across scopes.
 */
export interface GlobalDiscoveryClient {
  exploreCandidates(
    request: ExploreDiscoveryRequest,
    options?: GlobalDiscoveryRequestOptions,
  ): Promise<GlobalDiscoveryClientResult<ExploreDiscoveryResponse>>;

  nearbyIncidents(
    request: NearbyDiscoveryRequest,
    options?: GlobalDiscoveryRequestOptions,
  ): Promise<GlobalDiscoveryClientResult<NearbyDiscoveryResponse>>;
}
