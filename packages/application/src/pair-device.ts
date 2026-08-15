export type PairDeviceInput = {
  agentdBaseUrl: string;
};

export type PairingOffer = {
  pairingId: string;
  pairingCode: string;
  agentdBaseUrl: string;
  expiresAt: number;
};

export type PairingClaim = {
  pairingId: string;
  serverId: string;
  deviceName: string;
  deviceType: PairingDeviceType;
  platform: string | null;
  clientVersion: string | null;
  keyFingerprint: string;
  expiresAt: string;
};

export type PairingDeviceType = "browser" | "native" | "cli";

export type ApprovedDevice = {
  deviceId: string;
};

export interface PairingControlPort {
  createPairing(input: PairDeviceInput): Promise<PairingOffer>;
  waitForClaim(pairingId: string): Promise<PairingClaim>;
  approvePairing(pairingId: string): Promise<ApprovedDevice>;
  rejectPairing(pairingId: string): Promise<void>;
}

export interface PairingPresenterPort {
  showPairing(offer: PairingOffer): Promise<void>;
  confirmPairing(claim: PairingClaim): Promise<boolean>;
}

export type PairDeviceResult =
  | { status: "approved"; deviceId: string }
  | { status: "rejected" };

/**
 * Coordinates the device-pairing workflow without knowing how the control
 * channel or the user's terminal is implemented.
 */
export class PairDevice {
  public constructor(
    private readonly control: PairingControlPort,
    private readonly presenter: PairingPresenterPort,
  ) {}

  public async execute(input: PairDeviceInput): Promise<PairDeviceResult> {
    const offer = await this.control.createPairing(input);
    await this.presenter.showPairing(offer);

    const claim = await this.control.waitForClaim(offer.pairingId);
    const approved = await this.presenter.confirmPairing(claim);
    if (!approved) {
      await this.control.rejectPairing(claim.pairingId);
      return { status: "rejected" };
    }

    const device = await this.control.approvePairing(claim.pairingId);
    return { status: "approved", deviceId: device.deviceId };
  }
}
