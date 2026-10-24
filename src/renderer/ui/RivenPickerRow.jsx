// The Picker's riven entry (docs/port-rivens.md 11.5): a "Riven" menu button in the Picker's bar while picking for a
// general slot of a weapon that takes rivens, so the card grid keeps its rows. "New riven…" (or "Edit riven…" when the
// slot holds one) opens the riven dialog; the user's rivens of this weapon's family follow, each equipping a copy into
// the slot, and each can be removed from the user's rivens.
import {
  Button, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip,
} from '@fluentui/react-components';
import { DeleteRegular, EditRegular } from '@fluentui/react-icons';
import { actions } from '../controller.js';
import { useApp } from '../hooks.js';
import { EXILUS_SLOT, slotLabel } from '../model.js';
import { canTakeRiven, isRiven, libraryRivensFor, rivenLines, rivenShortName, rivenSlotBlockReason, rivenSummary } from '../../shared/rivens.js';

export function RivenPickerRow({ view }) {
  const ctx = useApp(s => s.ctx);
  const build = useApp(s => s.build);
  const library = useApp(s => s.rivenLibrary);
  const weapon = ctx.weaponByName.get(build.weaponName);
  const slot = view.targetSlot;
  if (view.tab !== 'mods' || !Number.isInteger(slot) || slot === EXILUS_SLOT || !canTakeRiven(weapon)) return null;
  const mine = libraryRivensFor(library, weapon);
  const here = build.mods[slot];
  const reason = rivenSlotBlockReason(build, weapon, slot);
  const equippedId = build.mods.find(isRiven)?.id ?? null;
  const label = slotLabel(slot).toLowerCase();
  const button = (
    <Button appearance="subtle" icon={<EditRegular />} data-testid="picker-rivens" aria-label={`Rivens for ${label}${reason ? `: ${reason}` : ''}`}>
      Riven
    </Button>
  );
  return (
    <Menu positioning="below-end">
      <MenuTrigger disableButtonEnhancement>
        {reason ? <Tooltip content={reason} relationship="description">{button}</Tooltip> : button}
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuItem icon={<EditRegular />} disabled={Boolean(reason)} onClick={() => actions.openRivenDialog(slot)} data-testid="picker-riven-new">
            {isRiven(here) ? 'Edit riven…' : 'New riven…'}
          </MenuItem>
          {mine.length ? (
            <>
              <MenuDivider />
              <MenuGroup>
                <MenuGroupHeader>Your rivens</MenuGroupHeader>
                {mine.map(r => (
                  <MenuItem
                    key={r.id}
                    disabled={r.id === equippedId || Boolean(reason)}
                    secondaryContent={rivenSummary(r)}
                    title={rivenLines(r).join(', ')}
                    aria-label={`Equip ${rivenShortName(r)} (rank ${r.rank}) in ${label}${r.id === equippedId ? ', equipped' : ''}`}
                    onClick={() => actions.equipLibraryRiven(r.id, slot)}
                    data-testid="picker-riven-library"
                  >
                    {rivenShortName(r)}
                  </MenuItem>
                ))}
              </MenuGroup>
              <MenuDivider />
              <MenuGroup>
                <MenuGroupHeader>Remove from your rivens</MenuGroupHeader>
                {mine.map(r => (
                  <MenuItem key={`rm-${r.id}`} icon={<DeleteRegular />} onClick={() => actions.removeLibraryRiven(r.id)}>
                    {rivenShortName(r)}
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          ) : null}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}
