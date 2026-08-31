import { SourceEntry, SourceRef } from './dataspace-source';

/**
 * Parsing of the connector's DCAT catalog, and construction of the contract
 * request that fetches an asset.
 *
 * Pure functions over parsed JSON: no HTTP, no clock, no configuration. The
 * shapes here were taken from live responses of the deployed connector, and the
 * fixtures under __fixtures__/ are those responses with identifiers redacted.
 */

/** One participant, as GET /bpn/all reports them. */
export interface Participant {
  bpn: string;
  name: string;
  /** The provider's control plane address — what a catalog request needs as counterPartyAddress. */
  direction: string;
  type: string;
}

export function parseParticipants(body: unknown): Participant[] {
  const list = (body as { participants?: unknown })?.participants;
  if (!Array.isArray(list)) return [];
  const out: Participant[] = [];
  for (const raw of list) {
    const p = raw as Partial<Participant>;
    if (typeof p?.bpn !== 'string' || !p.bpn) continue;
    if (typeof p?.direction !== 'string' || !p.direction) continue;
    out.push({
      bpn: p.bpn,
      name: typeof p.name === 'string' && p.name ? p.name : p.bpn,
      direction: p.direction,
      type: typeof p.type === 'string' ? p.type : 'unknown',
    });
  }
  return out;
}

/** Providers are the only participants worth asking for a catalog. */
export function dataProviders(participants: Participant[]): Participant[] {
  return participants.filter((p) => /provider/i.test(p.type));
}

/** What the source stores in SourceRef.payload for a data space asset. */
export interface DspacerRefPayload {
  providerBpn: string;
  providerName: string;
  counterPartyAddress: string;
  /**
   * The ODRL offer, verbatim from the catalog.
   *
   * It must be echoed back on transfer, and its `@id` encodes the asset's name
   * alongside the identifiers, so it changes when a provider renames the asset
   * or recreates the policy. Never persist it between runs: re-read the catalog.
   */
  offer: Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function distributionFormats(dataset: Record<string, unknown>): string[] {
  const formats = new Set<string>();
  for (const dist of asArray(dataset['dcat:distribution'])) {
    const fmt = (dist as { 'dct:format'?: { '@id'?: unknown } })?.[
      'dct:format'
    ]?.['@id'];
    if (typeof fmt === 'string' && fmt) formats.add(fmt);
  }
  return [...formats].sort();
}

/**
 * The distribution the API consumes.
 *
 * The connector offers PUSH variants too, which would have the provider deliver
 * to storage we own; PULL is the only one where the API gets the bytes back on
 * the same call.
 */
export const PULL_FORMAT = 'HttpData-PULL';

export interface ParsedCatalog {
  entries: SourceEntry[];
  warnings: string[];
}

/**
 * Turns one provider's catalog into source entries.
 *
 * A dataset with no usable offer is skipped with a warning rather than dropped:
 * silently ingesting fewer assets than a provider published is the kind of gap
 * nobody notices until a number looks wrong.
 */
export function parseCatalog(
  body: unknown,
  provider: Participant,
): ParsedCatalog {
  const entries: SourceEntry[] = [];
  const warnings: string[] = [];

  const datasets = asArray((body as Record<string, unknown>)?.['dcat:dataset']);
  if (!datasets.length) {
    return {
      entries,
      warnings: [`${provider.name} published an empty catalog`],
    };
  }

  for (const raw of datasets) {
    const dataset = raw as Record<string, unknown>;
    const id =
      typeof dataset['@id'] === 'string' ? (dataset['@id'] as string) : null;
    const name =
      typeof dataset['name'] === 'string' ? (dataset['name'] as string) : null;

    if (!id) {
      warnings.push(
        `${provider.name} published a dataset with no @id; skipped`,
      );
      continue;
    }
    if (!name) {
      warnings.push(
        `${provider.name} published dataset ${id} with no name; skipped`,
      );
      continue;
    }

    // One offer per dataset in practice, but the vocabulary allows a list and a
    // provider may offer the same asset under several policies.
    const offers = asArray(dataset['odrl:hasPolicy']).filter(
      (o): o is Record<string, unknown> => !!o && typeof o === 'object',
    );
    if (!offers.length) {
      warnings.push(`${provider.name}/${name} has no contract offer; skipped`);
      continue;
    }
    const offer = offers[0];
    if (offers.length > 1) {
      warnings.push(
        `${provider.name}/${name} offers ${offers.length} policies; the first was used (${String(offer['@id'])})`,
      );
    }
    if (typeof offer['@id'] !== 'string') {
      warnings.push(
        `${provider.name}/${name} has an offer with no @id; skipped`,
      );
      continue;
    }

    const formats = distributionFormats(dataset);
    if (formats.length && !formats.includes(PULL_FORMAT)) {
      warnings.push(
        `${provider.name}/${name} offers no ${PULL_FORMAT} distribution (${formats.join(', ')}); skipped`,
      );
      continue;
    }

    const payload: DspacerRefPayload = {
      providerBpn: provider.bpn,
      providerName: provider.name,
      counterPartyAddress: provider.direction,
      offer,
    };

    entries.push({
      ref: { id, label: name, payload },
      provider: provider.name,
      formats,
    });
  }

  return { entries, warnings };
}

/**
 * Builds the body of POST /transfer/request.
 *
 * The offer goes back exactly as the catalog gave it — the connector matches the
 * request against the published offer, so a normalised or re-serialised policy
 * is not the same policy.
 */
export function buildContractRequest(ref: SourceRef): Record<string, unknown> {
  const payload = ref.payload as DspacerRefPayload | undefined;
  if (!payload?.offer || !payload.counterPartyAddress || !payload.providerBpn) {
    throw new Error(
      `cannot build a transfer request for ${ref.id}: its catalog offer is missing. ` +
        `Re-read the provider catalog; offers are not valid across runs.`,
    );
  }

  const offer = payload.offer;
  return {
    '@context': [
      'https://w3id.org/tractusx/policy/v1.0.0',
      'http://www.w3.org/ns/odrl.jsonld',
      { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
    ],
    '@type': 'ContractRequest',
    counterPartyAddress: payload.counterPartyAddress,
    protocol: 'dataspace-protocol-http',
    policy: {
      assigner: payload.providerBpn,
      target: ref.id,
      '@id': offer['@id'],
      '@type': 'odrl:Offer',
      'odrl:permission': offer['odrl:permission'] ?? {},
      'odrl:prohibition': offer['odrl:prohibition'] ?? [],
      'odrl:obligation': offer['odrl:obligation'] ?? [],
    },
    callbackAddresses: [],
  };
}

/** The body of a catalog request for one provider. */
export function buildCatalogRequest(
  provider: Participant,
  opts: { offset?: number; limit?: number } = {},
): Record<string, unknown> {
  return {
    '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
    '@type': 'CatalogRequest',
    counterPartyAddress: provider.direction,
    counterPartyId: provider.bpn,
    protocol: 'dataspace-protocol-http',
    querySpec: { offset: opts.offset ?? 0, limit: opts.limit ?? 100 },
  };
}

/**
 * Explains a connector 500 in terms of where the exchange broke.
 *
 * The connector reports every downstream failure as a 500 with a nested body, so
 * an operator otherwise sees the same opaque error whether the contract was
 * refused, the transfer never started, or the provider's own backend is down.
 * The three are different problems for different people.
 */
export function explainTransferFailure(body: unknown): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === 'string') return detail;
  if (!detail || typeof detail !== 'object')
    return 'the connector returned an unrecognised error';

  const d = detail as {
    message?: unknown;
    downstream_status?: unknown;
    downstream_response?: unknown;
  };
  const message = typeof d.message === 'string' ? d.message : 'transfer failed';
  const status = d.downstream_status;
  const response =
    typeof d.downstream_response === 'string' ? d.downstream_response : '';

  if (
    /EDR transaction state/i.test(message) &&
    /^\s*\[\s*\]\s*$/.test(response)
  ) {
    return (
      `${message}. The contract negotiation produced no endpoint data reference, ` +
      `so the provider never opened a transfer. This is a provider-side or connector-side ` +
      `problem, not a missing asset.`
    );
  }
  if (/getting the data/i.test(message) && status === 404) {
    return (
      `${message}. The transfer was authorised but the provider's data plane returned 404, ` +
      `which means the asset is published without a resolvable data address.`
    );
  }
  return `${message}${status !== undefined ? ` (downstream ${String(status)})` : ''}${response ? `: ${response.slice(0, 200)}` : ''}`;
}
