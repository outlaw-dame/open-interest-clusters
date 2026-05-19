import {
  RECOMMENDATION_CATALOG_SCHEMA_VERSION,
  normalizeRecommendationCatalog,
  type RecommendationCanonicalTag,
  type RecommendationCatalog,
  type RecommendationCatalogPopularityTier,
  type RecommendationCatalogTopic
} from "./catalog.js";

export const RECOMMENDATION_GLOBAL_CATALOG_ID = "global.v1" as const;
export const RECOMMENDATION_GLOBAL_CATALOG_LOCALE = "en-US" as const;

interface SubtopicSeed {
  suffix: string;
  label: string;
  variants: string[];
  keywords: string[];
}

interface PrimaryTopicSeed {
  id: string;
  label: string;
  popularityTier: RecommendationCatalogPopularityTier;
  sensitive?: boolean;
  subtopics: SubtopicSeed[];
}

const PRIMARY_TOPIC_SEEDS: PrimaryTopicSeed[] = [
  {
    id: "gaming",
    label: "Gaming",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "playstation", label: "PlayStation", variants: ["PlayStation", "PS5", "PlayStation5", "PlayStationFive", "StateOfPlay", "SonyStateOfPlay", "PlayStationStateOfPlay"], keywords: ["playstation", "ps5", "sony console", "state of play", "sony state of play", "playstation state of play"] },
      { suffix: "xbox", label: "Xbox", variants: ["Xbox", "XboxSeriesX", "XboxSeriesS", "XboxGamesShowcase"], keywords: ["xbox", "console gaming", "xbox games showcase"] },
      { suffix: "rpg", label: "RPGs and JRPGs", variants: ["RPG", "RPGs", "JRPG", "JRPGs", "FinalFantasyVII", "FF7"], keywords: ["rpg", "jrpg", "final fantasy"] },
      { suffix: "showcases", label: "Gaming Showcases", variants: ["SummerGamesFest"], keywords: ["gaming showcase", "game showcase", "summer games fest"] }
    ]
  },
  {
    id: "pc-gaming",
    label: "PC Gaming",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "platforms", label: "PC Gaming Platforms", variants: ["PCGaming", "Steam", "SteamDeck"], keywords: ["pc gaming", "steam", "steam deck"] },
      { suffix: "hardware", label: "Gaming Hardware", variants: ["GamingPC", "PCBuild", "GPU", "CPU"], keywords: ["gaming pc", "pc build", "gpu"] },
      { suffix: "linux", label: "Linux Gaming", variants: ["LinuxGaming", "GamingonLinux"], keywords: ["linux gaming", "gaming on linux"] }
    ]
  },
  {
    id: "anime",
    label: "Anime",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "core", label: "Anime and Manga", variants: ["Anime", "AnimeNews", "Manga", "MangaNews", "CrunchyRoll"], keywords: ["anime", "manga", "anime news"] },
      { suffix: "shonen", label: "Shonen Anime", variants: ["Shonen", "DragonBall", "Naruto", "OnePiece", "DemonSlayer", "JJK"], keywords: ["shonen", "dragon ball", "naruto"] },
      { suffix: "seasonal", label: "Seasonal Anime", variants: ["Anime2026", "Frieren", "OshiNoKo", "DanDaDan", "SoloLeveling"], keywords: ["seasonal anime", "new anime"] }
    ]
  },
  {
    id: "music",
    label: "Music",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "releases", label: "Music Releases", variants: ["AlbumRelease", "Album", "Mixtape", "NewMusic"], keywords: ["new music", "album release"] },
      { suffix: "awards", label: "Music Awards and Festivals", variants: ["Grammy", "Grammys", "Concert", "MusicFestival"], keywords: ["grammys", "concerts", "music festival"] },
      { suffix: "hip-hop-rap", label: "Hip-Hop and Rap", variants: ["HipHop", "Rap", "DrillMusic", "Drake", "KendrickLamar"], keywords: ["hip hop", "rap", "drill music"] }
    ]
  },
  {
    id: "k-pop",
    label: "K-Pop",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "core", label: "K-Pop Core", variants: ["KPop", "KPopFans", "KPopFandom", "KPopFedi"], keywords: ["k-pop", "kpop", "k-pop fandom"] },
      { suffix: "groups", label: "K-Pop Groups", variants: ["BTS", "BlackPink", "AESPA", "NewJeans", "StrayKids"], keywords: ["bts", "blackpink", "newjeans"] },
      { suffix: "dance", label: "K-Pop Dance", variants: ["KPopDance", "KPopDanceChallenge"], keywords: ["k-pop dance", "dance challenge"] }
    ]
  },
  {
    id: "movies-tv",
    label: "Movies & TV",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "film", label: "Film and Cinema", variants: ["Film", "Films", "Movie", "Movies", "Cinema"], keywords: ["film", "movies", "cinema"] },
      { suffix: "streaming", label: "Streaming Platforms", variants: ["Netflix", "HBO", "DisneyPlus", "AppleTVPlus", "Hulu"], keywords: ["streaming", "netflix", "apple tv plus"] },
      { suffix: "awards", label: "TV and Film Awards", variants: ["Oscars", "TheOscars", "Emmys", "TheEmmys"], keywords: ["oscars", "emmys"] }
    ]
  },
  {
    id: "ai",
    label: "AI",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "generative", label: "Generative AI", variants: ["AI", "ArtificialIntelligence", "GenerativeAI", "GenAI", "ChatGPT"], keywords: ["ai", "generative ai", "chatgpt"] },
      { suffix: "models", label: "AI Models", variants: ["LLM", "LLMS", "LargeLanguageModel", "SmallLanguageModel"], keywords: ["llm", "large language model"] },
      { suffix: "tools", label: "AI Tools", variants: ["OpenAI", "Anthropic", "GoogleGemini", "DeepSeek", "HuggingFace"], keywords: ["openai", "anthropic", "gemini"] }
    ]
  },
  {
    id: "nfl",
    label: "NFL",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "core", label: "NFL Core", variants: ["NFL", "NationalFootballLeague", "NFLHighlights", "NFLonFedi"], keywords: ["nfl", "national football league"] },
      { suffix: "draft", label: "NFL Draft", variants: ["NFLDraft", "NFLCombine", "SeniorBowl"], keywords: ["nfl draft", "nfl combine"] },
      { suffix: "teams", label: "NFL Teams", variants: ["DallasCowboys", "KansasCityChiefs", "BuffaloBills", "PhiladelphiaEagles"], keywords: ["nfl teams", "chiefs", "cowboys"] }
    ]
  },
  {
    id: "nba",
    label: "NBA",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "core", label: "NBA Core", variants: ["NBA", "NBAHighlights", "NBAFedi", "NBAonMastodon"], keywords: ["nba", "nba highlights"] },
      { suffix: "events", label: "NBA Events", variants: ["SlamDunk", "AllStarWeekend", "NBAPlayoffs", "NBAFinals"], keywords: ["nba playoffs", "nba finals"] },
      { suffix: "teams", label: "NBA Teams", variants: ["BostonCeltics", "GoldenStateWarriors", "LALakers", "MiamiHeat"], keywords: ["nba teams", "lakers", "warriors"] }
    ]
  },
  {
    id: "wnba",
    label: "WNBA",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "WNBA Core", variants: ["WNBA", "WatchWomensSports", "WomensBasketball"], keywords: ["wnba", "womens basketball"] },
      { suffix: "teams", label: "WNBA Teams", variants: ["IndianaFever", "LasVegasAces", "NewYorkLiberty"], keywords: ["wnba teams"] },
      { suffix: "players", label: "WNBA Players", variants: ["CaitlinClark", "AjaWilson", "AngelReese"], keywords: ["wnba players"] }
    ]
  },
  {
    id: "sports",
    label: "Sports",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "general", label: "General Sports", variants: ["Sports", "TheEspys", "ESPN", "Olympics"], keywords: ["sports", "olympics"] },
      { suffix: "soccer", label: "Futbol and Soccer", variants: ["FIFA", "Futbol", "Soccer", "WorldCup", "PremierLeague"], keywords: ["soccer", "world cup"] },
      { suffix: "combat", label: "Combat Sports", variants: ["MMA", "MixedMartialArts", "UFC", "FightNight"], keywords: ["mma", "ufc"] }
    ]
  },
  {
    id: "politics",
    label: "Politics",
    popularityTier: "global_primary",
    sensitive: true,
    subtopics: [
      { suffix: "core", label: "Politics and Democracy", variants: ["Politics", "Democracy", "Government", "Policy"], keywords: ["politics", "democracy", "policy"] },
      { suffix: "us", label: "US Politics", variants: ["USPol", "USPolitics", "PoliticalNews"], keywords: ["us politics"] },
      { suffix: "global", label: "Global Politics", variants: ["GlobalNews", "GlobalPolitics", "Geopolitics"], keywords: ["global politics", "geopolitics"] }
    ]
  },
  {
    id: "fitness",
    label: "Fitness",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "workouts", label: "Workouts", variants: ["Exercise", "Workout", "Workouts", "HIIT", "Gym"], keywords: ["workout", "exercise", "gym"] },
      { suffix: "strength", label: "Strength Training", variants: ["Strength", "StrengthTraining", "LegDay"], keywords: ["strength training"] },
      { suffix: "yoga-pilates", label: "Yoga and Pilates", variants: ["Yoga", "Yogi", "Pilates", "Meditation"], keywords: ["yoga", "pilates"] }
    ]
  },
  {
    id: "mental-health-wellness",
    label: "Mental Health & Wellness",
    popularityTier: "global_primary",
    sensitive: true,
    subtopics: [
      { suffix: "core", label: "Mental Wellness", variants: ["MentalHealth", "Wellness", "Mindfulness", "SelfCare"], keywords: ["mental health", "wellness"] },
      { suffix: "therapy", label: "Therapy and Counseling", variants: ["Therapy", "Counseling", "Psychotherapy", "SocialWork"], keywords: ["therapy", "counseling"] },
      { suffix: "support", label: "Support and Recovery", variants: ["SupportGroup", "SupportGroups", "Recovery", "DigitalDetox"], keywords: ["support group", "recovery"] }
    ]
  },
  {
    id: "apple",
    label: "Apple",
    popularityTier: "global_standalone",
    subtopics: [
      { suffix: "products", label: "Apple Products", variants: ["Apple", "AppleWatch", "iPad", "iPhone", "Macbook", "MacbookPro"], keywords: ["apple", "iphone", "ipad", "macbook"] },
      { suffix: "software", label: "Apple Software", variants: ["iOS", "iOS26", "iPadOS", "macOS", "visionOS"], keywords: ["ios", "ipados", "macos"] },
      { suffix: "events", label: "Apple Events", variants: ["WWDC", "WWDC26", "AppleKeynote", "AppleEvent"], keywords: ["wwdc", "apple event"] }
    ]
  },
  {
    id: "technology",
    label: "Technology",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "consumer", label: "Consumer Technology", variants: ["Technology", "Tech", "Gadgets", "WearableTech"], keywords: ["technology", "wearable tech"] },
      { suffix: "software", label: "Software and Apps", variants: ["Software", "Apps", "Cybersecurity"], keywords: ["software", "apps"] },
      { suffix: "emerging", label: "Emerging Technology", variants: ["VR", "AR", "Blockchain", "IoT"], keywords: ["vr", "ar", "blockchain"] }
    ]
  },
  {
    id: "business-finance",
    label: "Business & Finance",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "markets", label: "Markets and Investing", variants: ["StockMarket", "StockMarkets", "WallSt", "WallStreet"], keywords: ["stock market", "wall street"] },
      { suffix: "crypto", label: "Crypto and Web3", variants: ["Crypto", "Bitcoin", "Ethereum", "DeFi"], keywords: ["crypto", "bitcoin"] },
      { suffix: "startups", label: "Startups and Entrepreneurship", variants: ["Startup", "Entrepreneur", "Founder", "SoloPreneur"], keywords: ["startup", "entrepreneurship"] }
    ]
  },
  {
    id: "travel-leisure",
    label: "Travel & Leisure",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "outdoors", label: "Outdoors", variants: ["Outdoors", "Hiking", "Camping", "NationalParks"], keywords: ["outdoors", "hiking"] },
      { suffix: "travel", label: "Travel", variants: ["Travel", "Vacation", "SoloTravel", "TravelTips"], keywords: ["travel", "vacation"] },
      { suffix: "flights", label: "Flights and Airlines", variants: ["Flights", "CheapFlights", "RoadTrip", "Airlines"], keywords: ["flights", "road trip"] }
    ]
  },
  {
    id: "beauty-skincare",
    label: "Beauty and Skincare",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Beauty", variants: ["Beauty", "Aesthetics", "BeautyInfluencer"], keywords: ["beauty"] },
      { suffix: "skincare", label: "Skincare", variants: ["SkinCare", "SkinCareRoutine", "GlassSkin"], keywords: ["skincare"] },
      { suffix: "makeup", label: "Makeup", variants: ["Makeup", "MakeupTutorial", "MinimalMakeup"], keywords: ["makeup"] }
    ]
  },
  {
    id: "fashion-style",
    label: "Fashion & Style",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "trends", label: "Fashion Trends", variants: ["Fashion", "Style", "OOTD", "Y2KFashion"], keywords: ["fashion", "style"] },
      { suffix: "aesthetic", label: "Aesthetics", variants: ["IndieSleaze", "RetroAesthetic", "QuietLuxury"], keywords: ["quiet luxury"] },
      { suffix: "shopping", label: "Shopping and Deals", variants: ["TikTokShop", "AmazonFinds", "Deals"], keywords: ["shopping", "deals"] }
    ]
  },
  {
    id: "content-creators",
    label: "Content Creators",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Creator Economy", variants: ["ContentCreator", "CreatorEconomy", "YouTuber", "Streamer"], keywords: ["content creator"] },
      { suffix: "monetization", label: "Creator Monetization", variants: ["Patreon", "Subscribe", "Sponsors"], keywords: ["patreon", "sponsors"] },
      { suffix: "production", label: "Creator Production", variants: ["DeskSetup", "VideoProduction", "Editing"], keywords: ["video production"] }
    ]
  },
  {
    id: "eco-friendly",
    label: "Eco-Friendly",
    popularityTier: "domain_primary",
    subtopics: [
      { suffix: "gardening", label: "Gardening", variants: ["PlantParent", "Gardening", "IndoorGarden"], keywords: ["gardening"] },
      { suffix: "sustainability", label: "Sustainability", variants: ["EcoFriendly", "Sustainable", "GreenLiving"], keywords: ["sustainability"] },
      { suffix: "ev", label: "Eco-Friendly Transportation", variants: ["GreenTransportation", "SustainableTransport", "CleanTransportation"], keywords: ["electric vehicles", "sustainable transport"] }
    ]
  },
  {
    id: "animals",
    label: "Animals",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "wildlife", label: "Wildlife", variants: ["Animals", "WildLife", "Jungle", "OceanLife"], keywords: ["wildlife"] },
      { suffix: "conservation", label: "Conservation", variants: ["Conservation", "AnimalRescue", "AnimalWelfare"], keywords: ["conservation"] },
      { suffix: "nature", label: "Nature Documentary", variants: ["Nature", "NatureDocumentary", "Safari"], keywords: ["nature documentary"] }
    ]
  },
  {
    id: "pets",
    label: "Pets",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "dogs", label: "Dogs", variants: ["Dogs", "Dog", "Puppy", "DogTraining"], keywords: ["dogs"] },
      { suffix: "cats", label: "Cats", variants: ["Cats", "Cat", "Kitten", "CatBehavior"], keywords: ["cats"] },
      { suffix: "care", label: "Pet Care", variants: ["Pets", "PetCare", "PetParent", "Vet"], keywords: ["pet care"] }
    ]
  },
  {
    id: "books-literature",
    label: "Books & Literature",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Books", variants: ["Books", "Booksky", "Bookstodon", "BookTok"], keywords: ["books"] },
      { suffix: "community", label: "Reading Community", variants: ["ReadingCommunity", "BookClub", "BookClubs"], keywords: ["reading community"] },
      { suffix: "recommendations", label: "Book Recommendations", variants: ["BookRecommendation", "BookRecommendations", "BookReview"], keywords: ["book recommendations"] }
    ]
  },
  {
    id: "food-cooking",
    label: "Food & Cooking",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Food Culture", variants: ["Food", "Foodstr", "Foodsky", "Foodie"], keywords: ["food"] },
      { suffix: "recipes", label: "Recipes", variants: ["AirFryer", "AirFryerRecipes", "FamilyRecipe", "Baking"], keywords: ["recipes"] },
      { suffix: "cuisines", label: "Cuisines", variants: ["SoulFood", "ItalianFood", "ChineseFood", "Seafood"], keywords: ["cuisines"] }
    ]
  },
  {
    id: "science",
    label: "Science",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Science News", variants: ["Science", "ScienceNews", "Research"], keywords: ["science"] },
      { suffix: "space", label: "Space", variants: ["Space", "Astronomy", "NASA"], keywords: ["space"] },
      { suffix: "climate", label: "Climate Science", variants: ["ClimateScience", "ClimateChange"], keywords: ["climate science"] }
    ]
  },
  {
    id: "internet-culture",
    label: "Internet Culture",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "memes", label: "Memes", variants: ["InternetCulture", "Memes", "Meme", "Viral"], keywords: ["memes"] },
      { suffix: "platforms", label: "Platform Culture", variants: ["TikTok", "YouTube", "Fediverse", "Mastodon", "Bluesky"], keywords: ["fediverse"] },
      { suffix: "fandoms", label: "Fandoms", variants: ["Fandom", "FanCulture", "StanTwitter"], keywords: ["fandom"] }
    ]
  },
  {
    id: "comedy",
    label: "Comedy",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "core", label: "Comedy", variants: ["Comedy", "Funny", "Laugh"], keywords: ["comedy"] },
      { suffix: "standup", label: "Stand-Up Comedy", variants: ["StandUp", "StandUpComedy", "Comedian"], keywords: ["stand up comedy"] },
      { suffix: "satire", label: "Satire", variants: ["Satire", "SlapStickComedy", "ComicView"], keywords: ["satire"] }
    ]
  },
  {
    id: "crafts-diy",
    label: "Crafts and DIY",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "home", label: "Home DIY", variants: ["DIY", "HomeDIY", "HomeImprovement"], keywords: ["diy"] },
      { suffix: "crafts", label: "Arts and Crafts", variants: ["Crafts", "Crafting", "Handmade"], keywords: ["crafts"] },
      { suffix: "textiles", label: "Sewing and Textiles", variants: ["Sewing", "Knitting", "Crocheting"], keywords: ["sewing"] }
    ]
  },
  {
    id: "photography",
    label: "Photography",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "gear", label: "Camera Gear", variants: ["Photography", "Camera", "Lens"], keywords: ["photography"] },
      { suffix: "technique", label: "Photo Techniques", variants: ["PortraitPhotography", "LandscapePhotography", "StreetPhotography"], keywords: ["photo techniques"] },
      { suffix: "editing", label: "Photo Editing", variants: ["PhotoEditing", "RAW", "Lightroom"], keywords: ["photo editing"] }
    ]
  },
  {
    id: "automobiles-evs",
    label: "Automobiles & EVs",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "ev", label: "Electric Vehicles", variants: ["EV", "EVs", "ElectricVehicle", "Tesla"], keywords: ["electric vehicles"] },
      { suffix: "reviews", label: "Car Reviews", variants: ["CarReview", "CarReviews", "TestDrive"], keywords: ["car review"] },
      { suffix: "culture", label: "Car Culture", variants: ["CarCulture", "CarShow", "JDM"], keywords: ["car culture"] }
    ]
  },
  {
    id: "esports-game-streaming",
    label: "Esports & Game Streaming",
    popularityTier: "global_primary",
    subtopics: [
      { suffix: "esports", label: "Esports", variants: ["Esports", "CompetitiveGaming", "Tournament"], keywords: ["esports"] },
      { suffix: "streaming", label: "Game Streaming", variants: ["GameStreaming", "GamingStream", "Twitch"], keywords: ["game streaming"] },
      { suffix: "creators", label: "Gaming Creators", variants: ["GamingCreator", "LetsPlay", "Gameplay"], keywords: ["gaming creator"] }
    ]
  }
];

function hashtagForLabel(label: string): string {
  const compact = label.replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length === 0) {
    throw new TypeError("Invalid recommendation global catalog label.");
  }

  return `#${compact}`;
}

function buildGlobalCatalog(): RecommendationCatalog {
  const topics: RecommendationCatalogTopic[] = [];
  const canonicalTags: RecommendationCanonicalTag[] = [];

  for (const primary of PRIMARY_TOPIC_SEEDS) {
    const subtopicIds = primary.subtopics.map((subtopic) => `${primary.id}.${subtopic.suffix}`);
    const primaryHashtag = hashtagForLabel(primary.label);
    const primaryTopic: RecommendationCatalogTopic = {
      id: primary.id,
      kind: "primary",
      label: primary.label,
      popularityTier: primary.popularityTier,
      subtopicIds,
      canonicalTagIds: [primary.id],
      keywords: [primary.label],
      hashtags: [primaryHashtag]
    };

    if (primary.sensitive === true) {
      primaryTopic.sensitive = true;
    }

    topics.push(primaryTopic);
    canonicalTags.push({
      id: primary.id,
      displayLabel: primary.label,
      variants: [primary.label],
      hashtags: [primaryHashtag],
      parentTopicIds: [primary.id]
    });

    for (const subtopic of primary.subtopics) {
      const id = `${primary.id}.${subtopic.suffix}`;
      const topic: RecommendationCatalogTopic = {
        id,
        kind: "subtopic",
        label: subtopic.label,
        primaryTopicId: primary.id,
        canonicalTagIds: [id],
        keywords: subtopic.keywords,
        hashtags: subtopic.variants.map((variant) => `#${variant}`)
      };
      const canonicalTag: RecommendationCanonicalTag = {
        id,
        displayLabel: subtopic.label,
        variants: subtopic.variants,
        hashtags: subtopic.variants.map((variant) => `#${variant}`),
        parentTopicIds: [id]
      };

      if (primary.sensitive === true) {
        topic.sensitive = true;
      }

      topics.push(topic);
      canonicalTags.push(canonicalTag);
    }
  }

  return normalizeRecommendationCatalog({
    schemaVersion: RECOMMENDATION_CATALOG_SCHEMA_VERSION,
    catalogId: RECOMMENDATION_GLOBAL_CATALOG_ID,
    locale: RECOMMENDATION_GLOBAL_CATALOG_LOCALE,
    topics,
    canonicalTags
  });
}

export const RECOMMENDATION_GLOBAL_CATALOG_V1 = buildGlobalCatalog();
