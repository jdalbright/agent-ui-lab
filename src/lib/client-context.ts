import type { ClientContext } from "@shared/schemas";

function sizeClass(): ClientContext["sizeClass"] {
  if (window.matchMedia("(max-width: 599px)").matches) return "compact";
  if (window.matchMedia("(max-width: 1023px)").matches) return "medium";
  return "expanded";
}

function preferredUnits(locale: string): ClientContext["units"] {
  const region = locale.split("-")[1]?.toUpperCase();
  return region === "US" || region === "LR" || region === "MM" ? "imperial" : "metric";
}

export function getClientContext(
  coordinates?: ClientContext["coordinates"],
): ClientContext {
  const locale = navigator.language || "en-US";
  return {
    sizeClass: sizeClass(),
    locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    units: preferredUnits(locale),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ...(coordinates ? { coordinates } : {}),
  };
}
export async function requestCoordinates(): Promise<ClientContext["coordinates"]> {
  if (!("geolocation" in navigator)) throw new Error("Geolocation is not available on this device.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      maximumAge: 5 * 60 * 1_000,
      timeout: 8_000,
    });
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    permission: "granted",
  };
}
