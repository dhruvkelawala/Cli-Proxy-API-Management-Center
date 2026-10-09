import { PROVIDER_LOGOS, type ProviderBrandLogoKey } from '../brandLogos';
import styles from './ProviderLogo.module.scss';

/** A provider's mark at text size, swapping to its dark-theme file where one exists. */
export function ProviderLogo({ brand, size = 20 }: { brand: ProviderBrandLogoKey; size?: number }) {
  const logo = PROVIDER_LOGOS[brand];
  if (!logo) return null;
  const base = [
    styles.logo,
    logo.themeSurface ? styles.themeSurface : '',
    logo.invertOnDark ? styles.invertOnDark : '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = { width: size, height: size };
  return (
    <span className={styles.wrap} aria-hidden="true">
      <img
        src={logo.src}
        alt=""
        style={style}
        className={logo.darkSrc ? `${base} ${styles.light}` : base}
      />
      {logo.darkSrc ? (
        <img src={logo.darkSrc} alt="" style={style} className={`${base} ${styles.dark}`} />
      ) : null}
    </span>
  );
}
