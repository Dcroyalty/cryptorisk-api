// lib/serper-map.ts — pure mapper for Serper's raw Google-search JSON payload.
// Shared verbatim between the hosted /api/search route (via lib/search-core.ts)
// and apify-actor-search/ (copied there byte-identical, same convention as
// apify-actor/lib/*.ts).
//
// organic/knowledgeGraph/answerBox/peopleAlsoAsk/relatedSearches/shopping field
// names are cross-checked against three independently maintained Serper
// clients (go-serper's client.go, mcp-server-serper's src/types/serper.ts,
// langchain-community's google_serper.py) as of 2026-09 and agree.
//
// `ads` and `aiOverview` have no stable documented schema anywhere those three
// clients or Serper's own public docs confirm — neither client implements
// them at all. Rather than guess field names and risk silently dropping
// whatever's actually in there (the exact bug this mapper exists to fix),
// both are passed through verbatim, unmodified.

export interface SerperSitelink {
  title: string;
  url: string;
}

export interface SerperOrganic {
  title: string;
  url: string;
  description: string;
  position: number | null;
  sitelinks?: SerperSitelink[];
  attributes?: Record<string, string>;
  date?: string;
}

export interface SerperKnowledgeGraph {
  title?: string;
  type?: string;
  website?: string;
  image_url?: string;
  description?: string;
  description_source?: string;
  description_link?: string;
  attributes?: Record<string, string>;
}

export interface SerperAnswerBox {
  answer?: string;
  title?: string;
  url?: string;
  snippet?: string;
  snippet_highlighted?: string[];
}

export interface SerperPeopleAlsoAsk {
  question: string;
  snippet?: string;
  title?: string;
  url?: string;
}

export interface SerperShoppingItem {
  title?: string;
  source?: string;
  url?: string;
  price?: string;
  delivery?: string;
  image_url?: string;
  rating?: number;
  rating_count?: number;
  offers?: string;
  product_id?: string;
  position?: number;
}

export interface SerperMapped {
  organic: SerperOrganic[];
  ads: unknown[];
  people_also_ask: SerperPeopleAlsoAsk[];
  related_searches: string[];
  knowledge_graph: SerperKnowledgeGraph | null;
  answer_box: SerperAnswerBox | null;
  shopping: SerperShoppingItem[];
  ai_overview: unknown | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapSerperResponse(raw: any): SerperMapped {
  const organic: SerperOrganic[] = Array.isArray(raw?.organic)
    ? raw.organic.map((r: Record<string, unknown>) => ({
        title: str(r?.title),
        url: str(r?.link),
        description: str(r?.snippet),
        position: typeof r?.position === "number" ? r.position : null,
        ...(Array.isArray(r?.sitelinks)
          ? {
              sitelinks: (r.sitelinks as Record<string, unknown>[]).map((s) => ({
                title: str(s?.title),
                url: str(s?.link),
              })),
            }
          : {}),
        ...(r?.attributes && typeof r.attributes === "object" ? { attributes: r.attributes as Record<string, string> } : {}),
        ...(r?.date ? { date: str(r.date) } : {}),
      }))
    : [];

  const people_also_ask: SerperPeopleAlsoAsk[] = Array.isArray(raw?.peopleAlsoAsk)
    ? raw.peopleAlsoAsk.map((p: Record<string, unknown>) => ({
        question: str(p?.question),
        ...(p?.snippet ? { snippet: str(p.snippet) } : {}),
        ...(p?.title ? { title: str(p.title) } : {}),
        ...(p?.link ? { url: str(p.link) } : {}),
      }))
    : [];

  const related_searches: string[] = Array.isArray(raw?.relatedSearches)
    ? raw.relatedSearches.map((r: Record<string, unknown>) => str(r?.query)).filter(Boolean)
    : [];

  const kg = raw?.knowledgeGraph as Record<string, unknown> | undefined;
  const knowledge_graph: SerperKnowledgeGraph | null = kg
    ? {
        ...(kg.title ? { title: str(kg.title) } : {}),
        ...(kg.type ? { type: str(kg.type) } : {}),
        ...(kg.website ? { website: str(kg.website) } : {}),
        ...(kg.imageUrl ? { image_url: str(kg.imageUrl) } : {}),
        ...(kg.description ? { description: str(kg.description) } : {}),
        ...(kg.descriptionSource ? { description_source: str(kg.descriptionSource) } : {}),
        ...(kg.descriptionLink ? { description_link: str(kg.descriptionLink) } : {}),
        ...(kg.attributes && typeof kg.attributes === "object" ? { attributes: kg.attributes as Record<string, string> } : {}),
      }
    : null;

  const ab = raw?.answerBox as Record<string, unknown> | undefined;
  const answer_box: SerperAnswerBox | null = ab
    ? {
        ...(ab.answer ? { answer: str(ab.answer) } : {}),
        ...(ab.title ? { title: str(ab.title) } : {}),
        ...(ab.link ? { url: str(ab.link) } : {}),
        ...(ab.snippet ? { snippet: str(ab.snippet) } : {}),
        ...(Array.isArray(ab.snippetHighlighted) ? { snippet_highlighted: ab.snippetHighlighted as string[] } : {}),
      }
    : null;

  const shopping: SerperShoppingItem[] = Array.isArray(raw?.shopping)
    ? raw.shopping.map((s: Record<string, unknown>) => ({
        ...(s?.title ? { title: str(s.title) } : {}),
        ...(s?.source ? { source: str(s.source) } : {}),
        ...(s?.link ? { url: str(s.link) } : {}),
        ...(s?.price ? { price: str(s.price) } : {}),
        ...(s?.delivery ? { delivery: str(s.delivery) } : {}),
        ...(s?.imageUrl ? { image_url: str(s.imageUrl) } : {}),
        ...(typeof s?.rating === "number" ? { rating: s.rating } : {}),
        ...(typeof s?.ratingCount === "number" ? { rating_count: s.ratingCount } : {}),
        ...(s?.offers ? { offers: str(s.offers) } : {}),
        ...(s?.productId ? { product_id: str(s.productId) } : {}),
        ...(typeof s?.position === "number" ? { position: s.position } : {}),
      }))
    : [];

  return {
    organic,
    ads: Array.isArray(raw?.ads) ? raw.ads : [],
    people_also_ask,
    related_searches,
    knowledge_graph,
    answer_box,
    shopping,
    ai_overview: raw?.aiOverview ?? null,
  };
}
