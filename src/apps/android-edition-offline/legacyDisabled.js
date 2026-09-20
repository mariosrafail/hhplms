import { ultimateB2ExercisePresentationFeatures } from "../../data/ultimate-b2/exerciseVisualCapabilities.js";

// Published native documents report their capabilities through presentation
// state. This edition contract does not resolve canonical legacy lesson IDs.
export const getUltimateB2ReadingExercisePresentationFeatures = () => ultimateB2ExercisePresentationFeatures(null);
