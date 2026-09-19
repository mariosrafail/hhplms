import { ultimateB2TeacherAppAuthoring } from "./teacherAppAuthoring.js";

const classroomAssets = import.meta.glob([
  "../../assets/books/ultimate-b2/legacy-classroom-ui/**/*.{png,jpg,jpeg,webp,gaf,mp3,wav}",
  "!../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/**",
], { eager: true, query: "?url", import: "default" });
const wiredPublisherNavibarAssets = import.meta.glob([
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-vocabulary-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-vocabulary-disabled.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-vocabulary-pressed.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-sb-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-gb-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-workbook-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-reload-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-reload-pressed.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-reload-disabled.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-all-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-all-pressed.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-all-disabled.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-next-active.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-next-pressed.png",
  "../../assets/books/ultimate-b2/legacy-classroom-ui/icons/navigation/publisher-navibar/navibar-show-next-disabled.png",
], { eager: true, query: "?url", import: "default" });
const studentsBookPartsBackground = import.meta.glob("../../assets/books/ultimate-b2/legacy-source/assets/books/book1/unit/2/parts/HD/parts_BG.png", { eager: true, query: "?url", import: "default" });
const authoredOverrides = import.meta.glob("../../assets/books/ultimate-b2/authoring/teacher-app/*.{png,jpg,jpeg,webp,gaf,mp3,wav}", { eager: true, query: "?url", import: "default" });
const pageAssets = import.meta.glob("../../../unit/{1,2,3,4,5,6,7,8,9,10}/parts/HD/*.{png,jpg,jpeg,webp}", { eager: true, query: "?url", import: "default" });
const nativeNavigationAssets = import.meta.glob("../../assets/native-activities/video-worksheet-navigation.png", { eager: true, query: "?url", import: "default" });
const allAssets = { ...nativeNavigationAssets, ...classroomAssets, ...wiredPublisherNavibarAssets, ...studentsBookPartsBackground, ...authoredOverrides, ...pageAssets };

function moduleKey(repositoryPath) {
  if (repositoryPath.startsWith("src/assets/")) return `../../assets/${repositoryPath.slice("src/assets/".length)}`;
  if (repositoryPath.startsWith("unit/")) return `../../../${repositoryPath}`;
  return "";
}

export function resolveUltimateB2AuthoredAssetUrl(bindingOrId) {
  const binding = typeof bindingOrId === "string" ? ultimateB2TeacherAppAuthoring.assets[bindingOrId] : bindingOrId;
  if (!binding) return null;
  return allAssets[moduleKey(binding.repositoryPath)] || null;
}
