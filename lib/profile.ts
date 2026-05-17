export type AccountProfile = {
  username: string;
  email: string;
  x: string;
  telegram: string;
  discord: string;
};

export const emptyProfile: AccountProfile = {
  username: "",
  email: "",
  x: "",
  telegram: "",
  discord: "",
};

export function profileStorageKey(address: string) {
  return `sealedsurvey:profile:${address.toLowerCase()}`;
}

export function loadStoredProfile(address: string): AccountProfile {
  if (typeof window === "undefined") return emptyProfile;
  try {
    const raw = localStorage.getItem(profileStorageKey(address));
    return raw ? { ...emptyProfile, ...JSON.parse(raw) } : emptyProfile;
  } catch {
    return emptyProfile;
  }
}

export function saveStoredProfile(address: string, profile: AccountProfile) {
  localStorage.setItem(profileStorageKey(address), JSON.stringify(profile));
}

export function hasRequiredProfile(profile: AccountProfile) {
  return Boolean(profile.username.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim()));
}

export function normalizedProfileEmail(profile: AccountProfile) {
  return profile.email.trim().toLowerCase();
}
