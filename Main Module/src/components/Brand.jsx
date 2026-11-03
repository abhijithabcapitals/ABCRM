import logo from "../assets/ab-capital-logo.webp";

export const COPYRIGHT = "© 2026. All Rights Reserved, AB Capital Services FZC Dubai, UAE";

// The logo has dark lettering, so `plate` puts it on white for dark backgrounds.
export function BrandLogo({ height = 44, plate = false }) {
  const image = <img src={logo} alt="AB Capital" style={{ display: "block", height, width: "auto", maxWidth: "100%" }} />;
  if (!plate) return image;
  return <div className="brand-plate">{image}</div>;
}

export function BrandFooter() {
  return <footer className="brand-footer">{COPYRIGHT}</footer>;
}
