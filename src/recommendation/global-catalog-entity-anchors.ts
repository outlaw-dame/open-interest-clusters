import type { RecommendationCatalogEntityRef } from "./catalog.js";

function wikidataRef(id: string, label: string): RecommendationCatalogEntityRef {
  return Object.freeze({
    source: "wikidata",
    id,
    label,
    uri: `https://www.wikidata.org/wiki/${id}`
  });
}

function dbpediaRef(id: string, label: string): RecommendationCatalogEntityRef {
  return Object.freeze({
    source: "dbpedia",
    id,
    label,
    uri: `https://dbpedia.org/resource/${id}`
  });
}

function entityRefs(...refs: RecommendationCatalogEntityRef[]): readonly RecommendationCatalogEntityRef[] {
  return Object.freeze(refs);
}

const videoGameEntityRefs = entityRefs(
  wikidataRef("Q7889", "Video game"),
  dbpediaRef("Video_game", "Video game")
);
const animeAndMangaEntityRefs = entityRefs(
  wikidataRef("Q1107", "Anime"),
  dbpediaRef("Anime", "Anime"),
  wikidataRef("Q8274", "Manga"),
  dbpediaRef("Manga", "Manga")
);
const musicEntityRefs = entityRefs(
  wikidataRef("Q638", "Music"),
  dbpediaRef("Music", "Music")
);
const filmEntityRefs = entityRefs(
  wikidataRef("Q11424", "Film"),
  dbpediaRef("Film", "Film")
);
const netflixEntityRefs = entityRefs(
  wikidataRef("Q907311", "Netflix"),
  dbpediaRef("Netflix", "Netflix")
);
const associationFootballEntityRefs = entityRefs(
  wikidataRef("Q2736", "Association football"),
  dbpediaRef("Association_football", "Association football")
);
const olympicGamesEntityRefs = entityRefs(
  wikidataRef("Q5389", "Olympic Games"),
  dbpediaRef("Olympic_Games", "Olympic Games")
);
const physicalFitnessEntityRefs = entityRefs(
  wikidataRef("Q309252", "Physical fitness"),
  dbpediaRef("Physical_fitness", "Physical fitness")
);
const yogaEntityRefs = entityRefs(
  wikidataRef("Q9350", "Yoga"),
  dbpediaRef("Yoga", "Yoga")
);
const wellnessEntityRefs = entityRefs(
  wikidataRef("Q317309", "Mental health"),
  dbpediaRef("Mental_health", "Mental health")
);
const technologyEntityRefs = entityRefs(
  wikidataRef("Q11016", "Technology"),
  dbpediaRef("Technology", "Technology")
);
const softwareEntityRefs = entityRefs(
  wikidataRef("Q7397", "Software"),
  dbpediaRef("Software", "Software")
);
const blockchainEntityRefs = entityRefs(
  wikidataRef("Q20514253", "Blockchain"),
  dbpediaRef("Blockchain", "Blockchain")
);
const scienceEntityRefs = entityRefs(
  wikidataRef("Q336", "Science"),
  dbpediaRef("Science", "Science")
);
const photographyEntityRefs = entityRefs(
  wikidataRef("Q11633", "Photography"),
  dbpediaRef("Photography", "Photography")
);
const comedyEntityRefs = entityRefs(
  wikidataRef("Q40831", "Comedy"),
  dbpediaRef("Comedy", "Comedy")
);
const carEntityRefs = entityRefs(
  wikidataRef("Q1420", "Car"),
  dbpediaRef("Car", "Car")
);
const electricCarEntityRefs = entityRefs(
  wikidataRef("Q193692", "Electric car"),
  dbpediaRef("Electric_car", "Electric car")
);
const animalEntityRefs = entityRefs(
  wikidataRef("Q729", "Animal"),
  dbpediaRef("Animal", "Animal")
);
const bookEntityRefs = entityRefs(
  wikidataRef("Q571", "Book"),
  dbpediaRef("Book", "Book")
);
const foodEntityRefs = entityRefs(
  wikidataRef("Q2095", "Food"),
  dbpediaRef("Food", "Food")
);

export const RECOMMENDATION_GLOBAL_CATALOG_ENTITY_ANCHORS: Readonly<Record<string, readonly RecommendationCatalogEntityRef[]>> = Object.freeze({
  "anime.core": animeAndMangaEntityRefs,
  "animals": animalEntityRefs,
  "animals.wildlife": animalEntityRefs,
  "automobiles-evs.culture": carEntityRefs,
  "automobiles-evs.ev": electricCarEntityRefs,
  "books-literature": bookEntityRefs,
  "books-literature.core": bookEntityRefs,
  "business-finance.crypto": blockchainEntityRefs,
  "comedy": comedyEntityRefs,
  "comedy.core": comedyEntityRefs,
  "fitness": physicalFitnessEntityRefs,
  "fitness.workouts": physicalFitnessEntityRefs,
  "fitness.yoga-pilates": yogaEntityRefs,
  "food-cooking": foodEntityRefs,
  "food-cooking.core": foodEntityRefs,
  "gaming": videoGameEntityRefs,
  "mental-health-wellness": wellnessEntityRefs,
  "mental-health-wellness.core": wellnessEntityRefs,
  "movies-tv.film": filmEntityRefs,
  "movies-tv.streaming": netflixEntityRefs,
  "music": musicEntityRefs,
  "photography": photographyEntityRefs,
  "photography.gear": photographyEntityRefs,
  "science": scienceEntityRefs,
  "science.core": scienceEntityRefs,
  "sports.general": olympicGamesEntityRefs,
  "sports.soccer": associationFootballEntityRefs,
  "technology": technologyEntityRefs,
  "technology.consumer": technologyEntityRefs,
  "technology.software": softwareEntityRefs
});
