import LegalDocument from "@/components/LegalDocument";
import source from "@/content/privacy.md?raw";

export default function Privacy() {
  return <LegalDocument source={source} />;
}
