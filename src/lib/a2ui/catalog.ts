import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog } from "@a2ui/web_core/v0_9";
import { CATALOG_ID } from "@shared/constants";
import { comparisonComponents } from "./components/comparison";
import { layoutComponents } from "./components/layout";
import { researchComponents } from "./components/research";
import { weatherComponents } from "./components/weather";
import "./styles.css";

export const trustedComponents: readonly ReactComponentImplementation[] = Object.freeze([
  ...layoutComponents,
  ...weatherComponents,
  ...comparisonComponents,
  ...researchComponents,
]);

export const trustedCatalog = new Catalog(CATALOG_ID, [...trustedComponents]);
