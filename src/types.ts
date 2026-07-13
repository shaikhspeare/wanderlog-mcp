export type PlaceGeometry = {
  location: { lat: number; lng: number };
};

export type PlaceData = {
  name: string;
  place_id: string;
  geometry?: PlaceGeometry;
  formatted_address?: string;
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  international_phone_number?: string;
  types?: string[];
  photo_urls?: string[];
  business_status?: string;
  opening_hours?: { weekday_text?: string[] };
  amenities?: Record<string, boolean>;
};

export type HotelBooking = {
  checkIn: string | null;
  checkOut: string | null;
  travelerNames: string[];
  confirmationNumber: string | null;
};

/** Quill-style rich text used for notes and place descriptions. */
export type QuillDelta = {
  ops?: Array<{
    insert?: string;
    attributes?: { link?: string; [k: string]: unknown };
  }>;
};

export type PlaceBlock = {
  id: number;
  type: "place";
  place: PlaceData;
  text?: QuillDelta;
  hotel?: HotelBooking;
  startTime?: string;
  endTime?: string;
  imageKeys?: string[];
};

export type NoteBlock = {
  id: number;
  type: "note";
  text?: QuillDelta;
  addedBy?: { type: string; userId: number };
  attachments?: unknown[];
};

export type ChecklistItem = {
  id: number;
  checked: boolean;
  text?: QuillDelta;
};

export type ChecklistBlock = {
  id: number;
  type: "checklist";
  items: ChecklistItem[];
  title?: string;
  addedBy?: { type: string; userId: number };
  attachments?: unknown[];
};

export type AirportEndpoint = {
  date?: string;
  time?: string;
  airport?: {
    name?: string;
    iata?: string;
    cityName?: string;
  };
};

export type FlightBlock = {
  id: number;
  type: "flight";
  flightInfo?: {
    airline?: { name?: string; iata?: string };
    number?: number | string;
  };
  depart?: AirportEndpoint;
  arrive?: AirportEndpoint;
  confirmationNumber?: string;
  travelerNames?: string[];
};

export type StationEndpoint = {
  date?: string;
  time?: string;
  place?: { name?: string; formatted_address?: string };
};

export type TrainBlock = {
  id: number;
  type: "train";
  carrier?: string;
  depart?: StationEndpoint;
  arrive?: StationEndpoint;
  confirmationNumber?: string;
  travelerNames?: string[];
};

/** Fallback for unknown block types we haven't mapped yet. */
export type UnknownBlock = {
  id: number;
  type: string;
};

export type Block =
  | PlaceBlock
  | NoteBlock
  | ChecklistBlock
  | FlightBlock
  | TrainBlock
  | UnknownBlock;

export function isPlaceBlock(block: Block): block is PlaceBlock {
  return block.type === "place" && "place" in block && !!(block as PlaceBlock).place;
}

export function isChecklistBlock(block: Block): block is ChecklistBlock {
  return block.type === "checklist" && "items" in block;
}

export type SectionType =
  | "textOnly"
  | "normal"
  | "hotels"
  | "flights"
  | "transit"
  | string;

export type Section = {
  id: number;
  type: SectionType;
  mode: "placeList" | "dayPlan" | string;
  heading: string;
  date: string | null;
  blocks: Block[];
  text?: QuillDelta;
  placeMarkerColor?: string;
  placeMarkerIcon?: string;
};

/** Money sub-object on a budget expense: `{ amount, currencyCode }`. */
export type ExpenseAmount = {
  amount: number;
  currencyCode: string;
  [k: string]: unknown;
};

/**
 * A budget expense at `trip.itinerary.budget.expenses[]`. Only the fields we
 * read or edit are typed; the index signature preserves the many other fields
 * Wanderlog attaches (paidByUser, splitWith, blockId, …) so edits don't drop
 * them.
 */
export type Expense = {
  id: number;
  amount: ExpenseAmount;
  category?: string;
  description?: string;
  /** Transaction date (YYYY-MM-DD). */
  date?: string;
  /** Trip day the expense is grouped under — this is what the budget UI shows. */
  associatedDate?: string;
  [k: string]: unknown;
};

export type Budget = {
  expenses?: Expense[];
  [k: string]: unknown;
};

export type Contributor = {
  id: number;
  username: string;
  name?: string;
};

export type Geo = {
  id: number;
  name: string;
  stateName?: string | null;
  countryName?: string | null;
  latitude: number;
  longitude: number;
  popularity?: number;
  subcategory?: string;
  bounds?: [number, number, number, number];
};

/**
 * A stop in a trip's journal (travelogue). Each stop pins a place with a
 * timestamp and a rich-text entry; `media` holds uploaded photos. Only the
 * fields we read or edit are typed — the index signature preserves the rest.
 */
export type JournalStop = {
  id: number;
  type: string;
  title?: string;
  /** ISO datetime with a destination timezone offset, e.g. "2026-06-14T09:00+08:00". */
  dateTime?: string;
  place?: PlaceData;
  text?: QuillDelta;
  media?: unknown[];
  [k: string]: unknown;
};

export type Journal = {
  stops?: JournalStop[];
  summary?: string;
  [k: string]: unknown;
};

export type TripPlan = {
  id: number;
  key: string;
  editKey?: string;
  viewKey?: string;
  suggestKey?: string;
  title: string;
  userId: number;
  privacy: string;
  startDate: string;
  endDate: string;
  days: number;
  placeCount: number;
  headerImageKey?: string;
  contributors?: Contributor[];
  editors?: Contributor[];
  itinerary: {
    sections: Section[];
    options?: unknown;
    budget?: Budget;
    journal?: Journal;
  };
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type TripPlanSummary = {
  id: number;
  key: string;
  title: string;
  startDate: string;
  endDate: string;
  placeCount: number;
  user?: Contributor;
  editedAt?: string;
  openedAt?: string;
  headerImageKey?: string;
  viewCount?: number;
  keyType?: string;
};

export type User = {
  id: number;
  username: string;
  name?: string;
  email?: string;
};

export type PlaceSuggestion = {
  description: string;
  place_id: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
  types?: string[];
};

export type GuideAuthor = {
  id: number;
  username: string;
  name: string;
  profilePictureKey?: string | null;
  visitGeosCount?: number;
  countriesCount?: number;
  showProfileProBadge?: boolean;
  isProUser?: boolean;
};

export type WanderlogGuide = {
  id: number;
  keyType: string;
  key: string;
  journalKey?: string;
  type: string;
  title: string;
  user: GuideAuthor;
  editedAt?: string;
  isPrimary?: boolean;
  placeCount?: number;
  journalStopCount?: number;
  openedAt?: string | null;
  headerImageKey?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number | null;
  collaborators?: GuideAuthor[];
  distinction?: string;
  itemType?: string;
  authorBlurb?: string;
  isDraft?: boolean;
  topImageKeys?: string[];
  imageCount?: number | null;
};

export type GeoWithGoodGuides = {
  id: number;
  name: string;
  stateName?: string | null;
  countryName?: string | null;
  depth?: number;
  latitude?: number;
  longitude?: number;
  parentId?: number | null;
  popularity?: number;
  subcategory?: string;
  bounds?: [number, number, number, number];
  imageKey?: string | null;
  countryCode?: string | null;
};

export type GuidesForGeoResponse = {
  geo: GeoWithGoodGuides;
  guides: WanderlogGuide[];
};

export type GuideGeoRef = {
  geo_id: number;
  name: string;
  country: string | null;
  subcategory: string | null;
};

export type GuideSummary = {
  guide_key: string;
  title: string;
  author: string;
  place_count: number | null;
  view_count: number | null;
  like_count: number | null;
  blurb: string | null;
  url: string;
  edited_at: string | null;
  author_name?: string;
  profile_picture_url?: string | null;
  distinction?: string | null;
  header_image_url?: string | null;
};

export type GuideSearchSuccess = {
  kind: "guides";
  geo: GuideGeoRef;
  alternative_geos: GuideGeoRef[];
  returned: number;
  total: number;
  guides: GuideSummary[];
};

export type GuideSearchNoGuides = {
  kind: "no_guides";
  resolved_geo: GuideGeoRef;
  alternative_geos_with_guides: GuideGeoRef[];
};

export type GuideSearchResult = GuideSearchSuccess | GuideSearchNoGuides;

export type LodgingId = {
  type: string;
  lodgingId: string;
};

export type LodgingImage = {
  url: string;
  thumbnailUrl: string;
};

export type LodgingPriceRate = {
  amount: number;
  currencyCode: string;
  total?: number;
  source?: string;
  frequency?: string;
  site: string;
  bookingUrl: string;
  hasFreeCancellation?: boolean;
  hasMemberDeal?: boolean;
  nightlyStrikethrough?: number;
};

/** Each amenity Wanderlog returns is an object, not a plain string. */
export type LodgingAmenity = {
  name: string;
  category: string | null;
};

export type LodgingInfo = {
  id: LodgingId;
  name: string;
  rating?: { source: string; value: number };
  ratingCount?: number;
  location: { latitude: number; longitude: number };
  images?: LodgingImage[];
  /** Array of amenity objects. lodgingType/accommodationType are absent in Google-sourced data. */
  amenities?: LodgingAmenity[];
  hotelClass?: number;
  lodgingType?: string;
  accommodationType?: string;
};

export type LodgingOffer = {
  lodging: LodgingInfo;
  offerId?: string;
  source?: string;
  priceRate?: LodgingPriceRate;
  priceRates?: LodgingPriceRate[];
  includesDueAtPropertyFees?: boolean;
};

export type LodgingSearchResponse = {
  isComplete: boolean;
  offers: LodgingOffer[];
};

export type HotelDeal = {
  vendor: string;
  price: number;
  url: string;
  free_cancellation: boolean;
  member_deal: boolean;
};

export type HotelOffer = {
  name: string;
  url: string;
  rating: number | null;
  rating_count: number | null;
  price_min: number;
  price_max: number;
  currency: string;
  location: { lat: number; lng: number };
  thumbnail: string | null;
  deals: HotelDeal[];
  // metadata fields (always populated; concise mode strips them before wire output)
  amenities: string[];
  hotel_class: number | null;
  lodging_type: string | null;
  accommodation_type: string | null;
};

export type HotelGeo = {
  geo_id: number;
  name: string;
  country: string | null;
  bounds: [number, number, number, number] | null;
};

export type HotelPriceBucket = {
  min: number;
  max: number | null;
  count: number;
};

export type HotelAvailableFilters = {
  hotel_classes: Record<string, number>;
  amenities: Record<string, number>;
  lodging_types: Record<string, number>;
  accommodation_types: Record<string, number>;
  sources: Record<string, number>;
  price_buckets: HotelPriceBucket[];
};

export type HotelSearchResult = {
  geo: HotelGeo;
  alternative_geos: HotelGeo[];
  currency: string;
  complete: boolean;
  total_results: number;
  returned: number;
  applied_filters: Record<string, unknown>;
  available_filters: HotelAvailableFilters;
  offers: HotelOffer[];
};
