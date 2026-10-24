import {describe,expect,it} from 'vitest';
import {RULES,type BadgeId,type Rank} from '@bluff-house/shared';
import {ACHIEVEMENTS,defaultMatchStats,updateAchievements,projectMatchStats} from '../../apps/server/src/game/achievements.js';
import {defaultProfile,PROFILE_COLORS} from '../../apps/server/src/game/profiles.js';
import {assertRoom} from '../../apps/server/src/game/engine.js';
import {fixture,shoe} from '../fixtures/core.js';
import {fundedFinale,lockShadowHands,declareShadow,finishFinale} from '../fixtures/shadow.js';

type F=ReturnType<typeof fixture>;
const badges=(f:F,seat=0)=>f.view().players[seat]!.profile.badges.map(b=>b.id);
function social(house=false){const f=fixture({mode:'PARTY',rounds:6,players:3});f.start();if(house)expect(f.send(f.host,'house:bid',{amount:50}).status).toBe('ok');f.advance(22000);f.advance(RULES.bettingMs+RULES.resultMs);return f;}
function settleRound(f:F){for(let n=0;n<20&&f.view().phase!=='ROUND_RESULT';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('ROUND_RESULT');}
function nextSocial(f:F,round:number){for(let n=0;n<40;n++){const v=f.view();if(v.phase==='SOCIAL'&&v.round===round)return;f.advance(v.deadline!-v.serverTime);}throw new Error('No next interval');}
function complete(f:F){for(let n=0;n<100&&f.view().phase!=='RESULTS';n++){const v=f.view();if(v.phase==='PLAYER_TURN')expect(f.send(v.activePlayerId!,'turn:stand').status).toBe('ok');else f.advance(v.deadline!-v.serverTime);}expect(f.view().phase).toBe('RESULTS');}

describe('a finite factual guest-session badge registry',()=>{
  it('exposes each released achievement once with its actual winning condition and no persistence promise',()=>{
    expect(ACHIEVEMENTS.map(b=>b.id)).toEqual(['HOUSEBREAKER','BOUNTY_HUNTER','MASTER_BLUFFER','VAULT_THIEF','UNTOUCHABLE','BETRAYER','HIGH_ROLLER','COMEBACK_KING']);expect(new Set(ACHIEVEMENTS.map(b=>b.id)).size).toBe(8);expect(ACHIEVEMENTS.find(b=>b.id==='MASTER_BLUFFER')!.description).toMatch(/five.*accepted.*guest session/i);expect(ACHIEVEMENTS.find(b=>b.id==='HIGH_ROLLER')!.description).toMatch(/duel.*Call My Bluff.*400/);expect(ACHIEVEMENTS.find(b=>b.id==='VAULT_THIEF')!.description).toMatch(/false.*uncalled.*changed.*winner/i);for(const b of ACHIEVEMENTS)expect(b.description).not.toMatch(/permanent|lifetime account|saved forever/i);
  });
  it('initializes bounded zero progress, empty badges and all zero detailed match statistics',()=>{
    const profile=defaultProfile('Ada Lovelace',0);expect(profile).toMatchObject({initials:'AL',color:PROFILE_COLORS[0],badges:[],acceptedBluffWins:0,matchProgress:{matchId:null,bottomTwo:false,bottomRoundId:null,lastSettledRoundId:null}});const stats=defaultMatchStats('player');expect(stats.playerId).toBe('player');expect(Object.entries(stats).filter(([key])=>key!=='playerId').every(([,n])=>n===0)).toBe(true);
  });
});

describe('accepted Call My Bluff progress and High Roller sources',()=>{
  it('counts five distinct accepted wins across replay, caps session progress and awards Master Bluffer only once',()=>{
    const f=fixture({ranks:['6','9','10','6','8','7','3']});let wins=0,firstEvidence:string|undefined;
    for(let match=0;match<2;match++){f.start();expect(f.view().matchStats.find(s=>s.playerId===f.host)!.bluffWins).toBe(0);for(let round=1;round<=3;round++){f.bet(50);f.deal();expect(f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:50}).status).toBe('ok');const previous=structuredClone(f.room());expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');wins++;const current=f.room(),once=structuredClone(current.players.map(p=>({profile:p.profile,stats:p.matchStats})));updateAchievements(previous,current,f.view().serverTime);expect(current.players.map(p=>({profile:p.profile,stats:p.matchStats}))).toEqual(once);expect(f.view().players[0]!.profile.progress.acceptedBluffWins).toBe(Math.min(5,wins));expect(badges(f).includes('MASTER_BLUFFER')).toBe(wins>=5);if(wins===5)firstEvidence=f.view().players[0]!.profile.badges.find(b=>b.id==='MASTER_BLUFFER')!.evidence.eventId;f.advance(RULES.revealMs);settleRound(f);f.advance(RULES.resultMs);}expect(f.view().phase).toBe('RESULTS');if(match===0)expect(f.send(f.host,'results:return').status).toBe('ok');}
    const earned=f.view().players[0]!.profile.badges.filter(b=>b.id==='MASTER_BLUFFER');expect(earned).toHaveLength(1);expect(earned[0]!.evidence.eventId).toBe(firstEvidence);expect(f.view().players[0]!.profile.progress.acceptedBluffWins).toBe(5);expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({bluffWins:3,bluffNet:150});assertRoom(f.room());
  });
  it.each<[Rank,number]>([['3',0],['K',1]])('credits an accepted400-chip pot to the actual winner when the forced card is %s',(hit,winner)=>{
    const f=fixture({ranks:['6','9','10','6','8','7',hit]});f.start();f.bet(50);f.deal();f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:200});expect(f.send(f.actors[1]!,'bluff:accept').status).toBe('ok');expect(badges(f,winner)).toContain('HIGH_ROLLER');expect(badges(f,winner===0?1:0)).not.toContain('HIGH_ROLLER');expect(f.view().players[winner]!.profile.progress.acceptedBluffWins).toBe(1);assertRoom(f.room());
  });
  it('does not count an expired unaccepted offer or a large Blackjack gross return as a peer-pot win',()=>{
    const f=fixture({ranks:['6','9','10','6','8','7','3']});f.start();f.bet(50);f.deal();f.send(f.host,'bluff:offer',{claimType:'NEXT_HIT_SAFE',amount:250});f.advance(RULES.offerMs);expect(f.view().players[0]!.profile.progress.acceptedBluffWins).toBe(0);expect(badges(f)).not.toContain('HIGH_ROLLER');
    const natural=fixture({ranks:['A','10','10','K','7','7']});natural.start();natural.bet(250);natural.deal();settleRound(natural);expect(natural.view().roundPayouts[0]!.returned).toBe(625);expect(badges(natural)).not.toContain('HIGH_ROLLER');
  });
  it.each([150,200])('uses a real funded duel pot at stake%i as the High Roller threshold',amount=>{
    const f=social();expect(f.send(f.host,'duel:invite',{defenderId:f.actors[1],amount}).status).toBe('ok');const invite=f.view().party!.social!.invites[0]!;expect(f.send(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'TAILS'},{inviteId:invite.id}).status).toBe('ok');expect(badges(f).includes('HIGH_ROLLER')).toBe(amount>=200);expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({duelWins:1,duelNet:amount});
  });
});

describe('released role, bounty, contract and causal Vault badges',()=>{
  it.each([false,true])('awards Housebreaker for a resolved overthrow with selection forfeit=%s',forfeit=>{
    const f=social(true);expect(f.send(f.actors[1]!,'house:ballot').status).toBe('ok');for(const actor of f.actors.slice(1))expect(f.send(actor,'house:vote',{yes:true}).status).toBe('ok');expect(badges(f,1)).not.toContain('HOUSEBREAKER');if(forfeit)f.advance(8000);else{expect(f.send(f.host,'house:choose',{game:'RPS'}).status).toBe('ok');expect(f.send(f.host,'duel:resign').status).toBe('ok');}expect(f.view().party!.houseId).toBe(f.actors[1]);expect(badges(f,1)).toContain('HOUSEBREAKER');expect(badges(f)).not.toContain('HOUSEBREAKER');const earned=f.view().players[1]!.profile.badges.find(b=>b.id==='HOUSEBREAKER')!;expect(earned.evidence.eventId).toBe(f.view().party!.overthrowHistory[0]!.id);expect(f.view().hostId).toBe(f.host);expect(f.view().matchStats.map(s=>s.houseReigns)).toEqual([1,1,0]);assertRoom(f.room());
  });
  it('awards Bounty Hunter on the actual85-percent funded payout, with no unaccepted-attempt badge',()=>{
    const f=social();f.send(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:150});const b=f.view().party!.bounties[0]!;f.send(f.host,'bounty:invite',{bountyId:b.id});expect(badges(f)).not.toContain('BOUNTY_HUNTER');const i=f.view().party!.social!.invites[0]!;expect(f.send(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'TAILS'},{inviteId:i.id}).status).toBe('ok');expect(badges(f)).toContain('BOUNTY_HUNTER');expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({bountyAwarded:127,bountiesClaimed:1,duelWins:1,duelNet:50});expect(badges(f)).not.toContain('HIGH_ROLLER');assertRoom(f.room());
  });
  it('awards Untouchable only after three real qualifying defenses claim the full bounty',()=>{
    const f=social();f.send(f.actors[2]!,'bounty:contribute',{targetId:f.actors[1],amount:250});const b=f.view().party!.bounties[0]!;for(let round=1;round<=3;round++){nextSocial(f,round);f.send(f.host,'bounty:invite',{bountyId:b.id});const i=f.view().party!.social!.invites.at(-1)!;expect(f.send(f.actors[1]!,'duel:accept',{game:'COIN',coinSide:'HEADS'},{inviteId:i.id}).status).toBe('ok');expect(badges(f,1).includes('UNTOUCHABLE')).toBe(round===3);}expect(f.view().matchStats.find(s=>s.playerId===f.actors[1])).toMatchObject({bountyAwarded:250,bountiesClaimed:1,duelWins:3,duelNet:150});assertRoom(f.room());
  });
  it.each([false,true])('awards Betrayer for a sole Steal and excludes the500-chip contract from High Roller, timeout=%s',timeout=>{
    const f=social();f.send(f.host,'deal:offer',{defenderId:f.actors[1],amount:250});const o=f.view().party!.social!.dealInvites[0]!;f.send(f.actors[1]!,'deal:accept',undefined,{dealOfferId:o.id});f.send(f.actors[1]!,'deal:choose',{choice:'SPLIT'});if(timeout)f.advance(10000);else f.send(f.host,'deal:choose',{choice:'STEAL'});expect(badges(f)).toContain('BETRAYER');expect(badges(f)).not.toContain('HIGH_ROLLER');expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({dealsPlayed:1,loneSteals:1,cooperations:0,dealNet:250});assertRoom(f.room());
  });
  it('awards Vault Thief only from an actually improved false-uncalled finale award and retains real Vault statistics',()=>{
    const f=fundedFinale();lockShadowHands(f,[0]);declareShadow(f,0,21);f.advance(8000);finishFinale(f);expect(badges(f)).toContain('VAULT_THIEF');expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({vaultWon:100,vaultVictories:1});expect(badges(f)).not.toContain('HIGH_ROLLER');const truthful=fundedFinale();lockShadowHands(truthful);declareShadow(truthful,0,19);truthful.advance(8000);finishFinale(truthful);expect(badges(truthful)).not.toContain('VAULT_THIEF');
  });
  it('counts actual shared Shadow winners as victories while excluding equal-share all-busted fallback payouts',()=>{
    const tied=fundedFinale({ranks:['10','9','10','7','8','7']});lockShadowHands(tied);finishFinale(tied);expect(tied.view().matchStats.map(s=>s.vaultVictories)).toEqual([1,1,1]);expect(tied.view().matchStats.map(s=>s.vaultWon)).toEqual([34,33,33]);const fallback=fundedFinale({ranks:['10','10','10','9','9','9','10','10','10']});lockShadowHands(fallback,[0,1,2]);finishFinale(fallback);expect(fallback.view().matchStats.map(s=>s.vaultWon)).toEqual([34,33,33]);expect(fallback.view().matchStats.map(s=>s.vaultVictories)).toEqual([0,0,0]);
  });
});

describe('actual non-final balance history and final Comeback standings',()=>{
  it('awards a first-place comeback only after a recorded bottom-two position in the same match',()=>{
    const f=fixture({players:3,ranks:['10','10','6','7']});f.start();f.send(f.host,'bet:submit',{amount:50});f.deal();settleRound(f);expect(f.view().players[0]!.balance).toBe(950);f.advance(RULES.resultMs);f.manager.e.shoe=()=>shoe(['A','10','K','7']);f.send(f.host,'bet:submit',{amount:50});f.deal();settleRound(f);expect(f.view().players[0]!.balance).toBe(1025);f.advance(RULES.resultMs);complete(f);expect(f.view().results!.winners).toEqual([f.host]);expect(badges(f)).toContain('COMEBACK_KING');expect(f.view().matchStats.find(s=>s.playerId===f.host)).toMatchObject({blackjackWins:1,blackjackLosses:1,blackjackNet:25});
  });
  it('does not award the initial leader who remained above both bottom positions',()=>{
    const f=fixture({players:3,ranks:['10','10','9','7']});f.start();f.send(f.host,'bet:submit',{amount:100});f.deal();settleRound(f);expect(f.view().players[0]!.balance).toBe(1100);f.advance(RULES.resultMs);complete(f);expect(f.view().results!.winners).toEqual([f.host]);expect(badges(f)).not.toContain('COMEBACK_KING');
  });
  it('includes every player tied at a bottom position and first place, and projects independent detailed statistics',()=>{
    const f=fixture({players:3});f.start();complete(f);for(let seat=0;seat<3;seat++)expect(badges(f,seat)).toContain('COMEBACK_KING');const actual=structuredClone(f.room().players.map(p=>p.matchStats)),stats=projectMatchStats(f.room());stats[0]!.blackjackNet=999;expect(f.room().players.map(p=>p.matchStats)).toEqual(actual);
  });
});
