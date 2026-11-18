import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import { Catalog } from "@a2ui/web_core/v0_9";
import { CATALOG_ID_V2, CATALOG_ID_V3 } from "@shared/constants";
import { comparisonComponents } from "./components/comparison";
import { insightComponents } from "./components/insights";
import { layoutComponents } from "./components/layout";
import { researchComponents } from "./components/research";
import { weatherComponents } from "./components/weather";
import "./styles.css";

export const trustedComponents: readonly ReactComponentImplementation[] = Object.freeze([
  ...layoutComponents,
  ...weatherComponents,
  ...comparisonComponents,
  ...researchComponents,
  ...insightComponents,
]);

export const trustedCatalog = new Catalog(CATALOG_ID_V2, [...trustedComponents]);
export const trustedCatalogV3 = new Catalog(CATALOG_ID_V3, [...trustedComponents]);
export const trustedCatalogs = Object.freeze([trustedCatalog, trustedCatalogV3]);
