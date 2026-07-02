export function barePhone(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/@.*/, "")
    .replace(/\D/g, "");
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = barePhone(a);
  const right = barePhone(b);
  return left.length > 0 && left === right;
}

export function userJid(value: string | null | undefined): string | null {
  const phone = barePhone(value);
  return phone ? `${phone}@c.us` : null;
}

export function configuredOwnerJid(): string | null {
  return userJid(process.env.BOT_OWNER_PHONE);
}
