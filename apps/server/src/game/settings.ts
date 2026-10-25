import {defaultSettings,type Command,type RoomSettings} from '@bluff-house/shared';
import {available} from './ledger.js';
import {dealPairUsed} from './deals.js';
import {requireRule,type Room,type Player,type EngineOptions} from './state.js';

const SETTING_KEYS=['maxPlayers','house','duels','overthrow','chaos','bounties','deals','doubleDown','extraClaims'] as const;
function settingsRecord(value:unknown):value is RoomSettings{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const record=value as Record<string,unknown>;
  return Object.keys(record).length===SETTING_KEYS.length&&Object.keys(record).every(key=>(SETTING_KEYS as readonly string[]).includes(key))&&Number.isSafeInteger(record.maxPlayers)&&Number(record.maxPlayers)>=2&&Number(record.maxPlayers)<=6&&SETTING_KEYS.filter(key=>key!=='maxPlayers').every(key=>typeof record[key]==='boolean');
}
function compatible(settings:RoomSettings){return (!settings.overthrow||settings.house&&settings.duels)&&(!settings.bounties||settings.duels);}
function isDefaultClassic(settings:RoomSettings){const defaults=defaultSettings('CLASSIC');return SETTING_KEYS.every(key=>settings[key]===defaults[key]);}

/** Whole configuration validation happens before any readiness or lobby context changes. */
export function configureSettings(r:Room,p:Player,c:Command,e:EngineOptions,now:number):boolean{
  requireRule(c.type==='lobby:settings'&&r.phase==='LOBBY','SETTINGS_LOCKED','Room settings can change only in the lobby.');requireRule(r.hostId===p.id,'NOT_HOST');
  const payload=c.payload;requireRule(payload&&Object.keys(payload).length===4&&Object.keys(payload).every(key=>['settings','rounds','finale','visibility'].includes(key)),'INVALID_SETTINGS','Submit the complete room configuration.');
  const {settings,rounds,finale,visibility}=payload;
  requireRule(settingsRecord(settings),'INVALID_SETTINGS','Choose a 2–6 player cap and supported boolean options.');
  requireRule(rounds===3||rounds===6,'INVALID_ROUNDS');requireRule(typeof finale==='boolean','INVALID_FINALE');requireRule(visibility==='PRIVATE'||visibility==='PUBLIC','INVALID_VISIBILITY');
  requireRule(settings.maxPlayers>=r.players.length,'CAPACITY_TOO_SMALL','The player cap must include every occupied seat, including disconnected guests.');
  requireRule(compatible(settings),'INCOMPATIBLE_SETTINGS','Overthrow requires House and duels; bounties require duels.');
  requireRule(r.mode==='PARTY'||rounds===3&&!finale&&isDefaultClassic(settings),'CLASSIC_SETTINGS_FIXED','Classic uses its fixed three-round rules and six-player cap.');
  const changed=SETTING_KEYS.some(key=>r.settings[key]!==settings[key])||r.roundLimit!==rounds||r.finaleEnabled!==finale||r.visibility!==visibility;
  if(!changed)return false;
  r.settings={maxPlayers:settings.maxPlayers,house:settings.house,duels:settings.duels,overthrow:settings.overthrow,chaos:settings.chaos,bounties:settings.bounties,deals:settings.deals,doubleDown:settings.doubleDown,extraClaims:settings.extraClaims};r.roundLimit=rounds;r.finaleEnabled=finale;r.visibility=visibility;r.lobbyId=e.id();
  for(const player of r.players)player.ready=false;
  r.events.push({id:e.id(),kind:'settings',text:'Room settings updated. Everyone must ready up again.',at:now,revision:r.revision+1});r.events=r.events.slice(-60);return true;
}

/** Avoid idle admission when every enabled social system is currently unavailable. */
export function hasEligibleSocial(r:Room):boolean{
  if(!r.party||r.mode!=='PARTY')return false;
  const connected=r.players.filter(p=>p.participating&&p.connected&&!p.departed),funded=connected.filter(p=>available(p.account)>=50);
  if(connected.length<2)return false;
  if(r.settings.duels&&funded.length>=2)return true;
  if(r.settings.deals&&funded.some((p,index)=>funded.slice(index+1).some(other=>!dealPairUsed(r,p.id,other.id))))return true;
  return r.settings.overthrow&&!!r.party.houseId&&r.round>=r.party.houseSinceRound+1&&connected.some(p=>p.id!==r.party!.houseId);
}

export function assertSettings(r:Room){
  requireRule(settingsRecord(r.settings)&&compatible(r.settings)&&(r.visibility==='PRIVATE'||r.visibility==='PUBLIC')&&r.players.length<=r.settings.maxPlayers,'ROOM_SETTINGS_INVARIANT');
  requireRule((r.roundLimit===3||r.roundLimit===6)&&typeof r.finaleEnabled==='boolean'&&(r.mode==='PARTY'||r.mode==='CLASSIC'&&r.roundLimit===3&&!r.finaleEnabled&&isDefaultClassic(r.settings)),'MODE_SETTINGS_INVARIANT');
  if(r.party){
    if(!r.settings.house)requireRule(r.party.houseId===null&&r.party.auction.status==='revealed'&&r.party.auction.winnerId===null&&r.party.auction.winningBid===0&&Object.keys(r.party.auction.bids).length===0,'DISABLED_HOUSE_INVARIANT');
    if(!r.settings.duels)requireRule(r.party.duelHistory.length===0&&!r.party.social?.duel&&(r.party.social?.invites.length??0)===0,'DISABLED_DUELS_INVARIANT');
    if(!r.settings.overthrow)requireRule(r.party.overthrowHistory.length===0&&!r.party.social?.ballot,'DISABLED_OVERTHROW_INVARIANT');
    if(!r.settings.bounties)requireRule(r.party.bounties.length===0,'DISABLED_BOUNTIES_INVARIANT');
    if(!r.settings.deals)requireRule(r.party.dealHistory.length===0&&!r.party.social?.deal&&(r.party.social?.dealInvites.length??0)===0,'DISABLED_DEALS_INVARIANT');
    if(!r.settings.chaos)requireRule(Object.values(r.party.chaos.inventories).every(cards=>cards.length===0)&&r.party.chaos.grantedRounds.length===0&&!r.party.chaos.potTwist&&!r.party.chaos.handWindow&&Object.keys(r.party.chaos.multipliers).length===0,'DISABLED_CHAOS_INVARIANT');
  }
}
