import steamLogo from '../assets/platforms/steam.svg'
import epicLogo from '../assets/platforms/epicgames.svg'
import xboxLogo from '../assets/platforms/xbox.svg'
import ubisoftLogo from '../assets/platforms/ubisoft.svg'
import eaLogo from '../assets/platforms/ea.svg'
import gogLogo from '../assets/platforms/gogdotcom.svg'
import battleNetLogo from '../assets/platforms/battlenet.svg'
import riotLogo from '../assets/platforms/riotgames.svg'
import localLogo from '../assets/platforms/local.svg'
import type { ArtworkPlatform, PlatformId } from '../shared/types'

export const platformLogos: Record<PlatformId, string> = {
  steam: steamLogo,
  epic: epicLogo,
  xbox: xboxLogo,
  ubisoft: ubisoftLogo,
  ea: eaLogo,
  gog: gogLogo,
  battlenet: battleNetLogo,
  riot: riotLogo,
  local: localLogo,
}

export interface PlatformEntry {
  id: PlatformId
  label: string
  /** false : simple point d'extension, sans détection ni lancement. */
  supported: boolean
}

export const platforms: PlatformEntry[] = [
  { id: 'steam', label: 'Steam', supported: true },
  { id: 'epic', label: 'Epic Games', supported: true },
  { id: 'riot', label: 'Riot Games', supported: true },
  { id: 'local', label: 'Jeux locaux', supported: true },
  { id: 'xbox', label: 'Xbox', supported: false },
  { id: 'ubisoft', label: 'Ubisoft Connect', supported: false },
  { id: 'ea', label: 'EA app', supported: false },
  { id: 'gog', label: 'GOG Galaxy', supported: false },
  { id: 'battlenet', label: 'Battle.net', supported: false },
]

export function platformLabel(id: PlatformId): string {
  return platforms.find((platform) => platform.id === id)?.label ?? id
}

export function toArtworkPlatform(platform: PlatformId): ArtworkPlatform | null {
  return platform === 'steam' || platform === 'epic' || platform === 'riot' || platform === 'local' ? platform : null
}

export function isLaunchable(platform: PlatformId): boolean {
  return toArtworkPlatform(platform) !== null
}
