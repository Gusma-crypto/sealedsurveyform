export function getConfiguredAdminWallets(): string[] {
  return (process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? "")
    .split(",")
    .map((wallet) => wallet.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminAddress(address?: string | null): boolean {
  if (!address) return false;
  const admins = getConfiguredAdminWallets();
  if (admins.length === 0) return true;
  return admins.includes(address.toLowerCase());
}

export function canCreateFormsAddress(address?: string | null): boolean {
  return Boolean(address);
}

export function shortenAddress(address: string, chars = 5): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
