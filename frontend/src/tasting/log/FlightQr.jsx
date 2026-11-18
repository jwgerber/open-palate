/** The QR for a flight link, in its own file so the encoder loads as a lazy chunk. */
import { QRCodeSVG } from 'qrcode.react';

export default function FlightQr({ value, label, size = 96 }) {
  return <QRCodeSVG value={value} size={size} bgColor="transparent" role="img" aria-label={label} />;
}
