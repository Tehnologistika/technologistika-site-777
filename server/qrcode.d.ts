declare module "qrcode" {
  interface QrCodeStatic {
    toString(
      text: string,
      options: {
        type: "svg";
        margin?: number;
        errorCorrectionLevel?: "L" | "M" | "Q" | "H";
        color?: { dark?: string; light?: string };
      },
      callback: (error: Error | null | undefined, value: string) => void
    ): void;
  }

  const QRCode: QrCodeStatic;
  export default QRCode;
}
