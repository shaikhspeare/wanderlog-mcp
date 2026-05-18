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
    budget?: unknown;
    journal?: unknown;
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
