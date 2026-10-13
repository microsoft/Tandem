import darkArtwork from "../../stage2/tandem/public/branding/tandem-blue-dark.png";
import lightArtwork from "../../stage2/tandem/public/branding/tandem-blue-light.png";

export function Brand({ tone = "dark" }: { tone?: "light" | "dark" } = {}) {
  return <div className="brand"><img className="brand-artwork" src={tone === "dark" ? darkArtwork : lightArtwork} alt="" aria-hidden="true" />
    <div className="brand-copy"><h1 className="visually-hidden">Tandem</h1></div></div>;
}
