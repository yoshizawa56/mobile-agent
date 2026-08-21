import { encodePairingCode } from "@muximo/api";
import {
  AuthService as ApplicationAuthService,
  type AuthPairingPayload,
  type AuthServiceOptions as ApplicationAuthServiceOptions,
  type MuximodAuthContext,
} from "@muximo/application";
import { nodeAuthCrypto } from "./auth-crypto.js";

export type AuthServiceOptions = Omit<ApplicationAuthServiceOptions, "crypto"> & {
  crypto?: ApplicationAuthServiceOptions["crypto"];
};
export type AuthContext = MuximodAuthContext;
export type { AuthPairingClaimNotification } from "@muximo/application";

/** Composition adapter that supplies the host crypto implementation. */
export class AuthService extends ApplicationAuthService {
  public constructor(options: AuthServiceOptions) {
    super({ ...options, crypto: options.crypto ?? nodeAuthCrypto });
  }
}

export function pairingPayloadCode(payload: AuthPairingPayload): string {
  return encodePairingCode(payload);
}
