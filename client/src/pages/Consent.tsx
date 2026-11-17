import LegalDocument from "@/components/LegalDocument";
import source from "@/content/consent.md?raw";

export default function Consent() {
  return <LegalDocument source={source} />;
}
