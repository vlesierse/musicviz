import type { Visual } from '../core/Visual';
import { WormholeVisual } from './01-wormhole';
import { PumpkinMorphVisual } from './02-pumpkin-morph';
import { GraveyardVisual } from './03-graveyard';
import { GhostFlowVisual } from './04-ghosts';
import { SpiderWebVisual } from './05-spider-web';
import { CauldronVisual } from './06-cauldron';
import { EyeVisual } from './07-eye';
import { SpectralTerrainVisual } from './08-terrain';
import { BatStormVisual } from './09-bat-storm';
import { PortalVisual } from './10-portal';
import { BloodRainVisual } from './11-blood-rain';
import { DraculaFangsVisual } from './12-fangs';
import { ZombieHordeVisual } from './13-zombies';
import { HauntedForestVisual } from './14-haunted-forest';
import { HauntedMansionVisual } from './15-mansion';
import { EyesInTheDarkVisual } from './16-eyes';
import { SkeletonDanceVisual } from './17-skeletons';
import { PossessedTvVisual } from './18-possessed-tv';
import { PumpkinPatchVisual } from './19-pumpkin-patch';
import { WitchFlightVisual } from './20-witches';

/** Order matters: keys 1–9, 0 select 1–10; Shift + 1–9, 0 select 11–20. */
export function createVisuals(): Visual[] {
  return [
    new WormholeVisual(),
    new PumpkinMorphVisual(),
    new GraveyardVisual(),
    new GhostFlowVisual(),
    new SpiderWebVisual(),
    new CauldronVisual(),
    new EyeVisual(),
    new SpectralTerrainVisual(),
    new BatStormVisual(),
    new PortalVisual(),
    new BloodRainVisual(),
    new DraculaFangsVisual(),
    new ZombieHordeVisual(),
    new HauntedForestVisual(),
    new HauntedMansionVisual(),
    new EyesInTheDarkVisual(),
    new SkeletonDanceVisual(),
    new PossessedTvVisual(),
    new PumpkinPatchVisual(),
    new WitchFlightVisual(),
  ];
}
