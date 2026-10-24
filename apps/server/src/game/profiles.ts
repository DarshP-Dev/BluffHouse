import type {Command,ProfileColor,ProfileView} from '@bluff-house/shared';
import {ACHIEVEMENTS} from './achievements.js';
import {requireRule,type Room,type Player,type ProfileState} from './state.js';

export const PROFILE_COLORS:readonly ProfileColor[]=['GOLD','RUBY','EMERALD','SAPPHIRE','VIOLET','CORAL'];
function validInitials(value:unknown):string|null{
  if(typeof value!=='string')return null;const initials=value.trim().normalize('NFC').toUpperCase();
  return /^[\p{L}\p{N}]{1,3}$/u.test(initials)?initials:null;
}
export function defaultProfile(name:string,seat:number):ProfileState{
  const initials=Array.from(name.trim().split(/\s+/).map(word=>Array.from(word)[0]??'').join('').toUpperCase()).slice(0,2).join('');
  return {initials:validInitials(initials)??'BH',color:PROFILE_COLORS[((seat%PROFILE_COLORS.length)+PROFILE_COLORS.length)%PROFILE_COLORS.length]!,badges:[],acceptedBluffWins:0,matchProgress:{matchId:null,bottomTwo:false,bottomRoundId:null,lastSettledRoundId:null}};
}
export function profileCommand(r:Room,p:Player,c:Command){
  requireRule(c.type==='profile:update'&&r.phase==='LOBBY','PROFILE_LOCKED','Edit your avatar in the lobby.');
  requireRule(p.connected&&!p.departed,'NOT_PARTICIPATING');
  const initials=validInitials(c.payload?.initials),color=c.payload?.color;
  requireRule(initials,'INVALID_INITIALS','Use one to three letters or numbers for your avatar.');
  requireRule(typeof color==='string'&&(PROFILE_COLORS as readonly string[]).includes(color),'INVALID_PROFILE_COLOR','Choose an available avatar color.');
  p.profile.initials=initials;p.profile.color=color as ProfileColor;
}
export function projectProfile(profile:ProfileState):ProfileView{
  return {initials:profile.initials,color:profile.color,badges:structuredClone(profile.badges),progress:{acceptedBluffWins:profile.acceptedBluffWins,masterBlufferTarget:5},lifetime:'guest-session'};
}
export function assertProfiles(r:Room){
  for(const p of r.players){
    const profile=p.profile;requireRule(profile&&validInitials(profile.initials)===profile.initials&&PROFILE_COLORS.includes(profile.color),'PROFILE_COSMETIC_INVARIANT');
    requireRule(Number.isSafeInteger(profile.acceptedBluffWins)&&profile.acceptedBluffWins>=0&&profile.acceptedBluffWins<=5,'PROFILE_PROGRESS_INVARIANT');
    requireRule(profile.badges.length<=ACHIEVEMENTS.length&&new Set(profile.badges.map(badge=>badge.id)).size===profile.badges.length,'PROFILE_BADGES_INVARIANT');
    for(const badge of profile.badges)requireRule(ACHIEVEMENTS.some(rule=>rule.id===badge.id)&&Number.isFinite(badge.earnedAt)&&typeof badge.evidence.matchId==='string'&&badge.evidence.matchId.length>0&&badge.evidence.matchId.length<=128&&typeof badge.evidence.eventId==='string'&&badge.evidence.eventId.length>0&&badge.evidence.eventId.length<=256&&typeof badge.evidence.description==='string'&&badge.evidence.description.length>0&&badge.evidence.description.length<=400,'PROFILE_BADGE_EVIDENCE_INVARIANT');
    const progress=profile.matchProgress;requireRule(progress&&progress.matchId===(r.matchId??null)&&typeof progress.bottomTwo==='boolean'&&(progress.bottomRoundId===null||typeof progress.bottomRoundId==='string')&&(progress.lastSettledRoundId===null||typeof progress.lastSettledRoundId==='string')&&(!progress.bottomTwo||progress.bottomRoundId!==null),'PROFILE_MATCH_PROGRESS_INVARIANT');
    requireRule(!profile.badges.some(badge=>badge.id==='MASTER_BLUFFER')||profile.acceptedBluffWins===5,'MASTER_BLUFFER_PROGRESS_INVARIANT');
    requireRule(p.matchStats.playerId===p.id&&Object.entries(p.matchStats).every(([key,value])=>key==='playerId'||Number.isSafeInteger(value)),'MATCH_STATS_INVARIANT');
    for(const key of ['blackjackWins','blackjackLosses','blackjackPushes','bluffWins','bluffLosses','duelWins','duelLosses','duelDraws','bountyAwarded','dealsPlayed','cooperations','loneSteals','vaultWon','houseReigns','bountiesClaimed','vaultVictories'] as const)requireRule(p.matchStats[key]>=0,'MATCH_STATS_NONNEGATIVE_INVARIANT');
  }
}
