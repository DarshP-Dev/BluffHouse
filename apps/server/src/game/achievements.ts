import type {BadgeId,BadgeRule,MatchStats} from '@bluff-house/shared';
import type {Room,Player} from './state.js';

export const ACHIEVEMENTS:readonly BadgeRule[]=[
  {id:'HOUSEBREAKER',name:'Housebreaker',description:'Take the House crown through a resolved overthrow, including a selection-deadline forfeit.'},
  {id:'BOUNTY_HUNTER',name:'Bounty Hunter',description:'Defeat a bounty target and receive the funded challenger bounty award.'},
  {id:'MASTER_BLUFFER',name:'Master Bluffer',description:'Win five accepted Call My Bluff challenges as claimant or caller during this guest session.'},
  {id:'VAULT_THIEF',name:'Vault Thief',description:'Win more Vault chips because a false uncalled declaration changed the winner set in your favor.'},
  {id:'UNTOUCHABLE',name:'Untouchable',description:'Win three consecutive qualifying bounty defenses and claim the funded bounty.'},
  {id:'BETRAYER',name:'Betrayer',description:'Receive the full funded Split or Steal pot as the sole Steal choice, including a disclosed timeout default.'},
  {id:'HIGH_ROLLER',name:'High Roller',description:'Win a funded duel or accepted Call My Bluff pot of at least 400 chips. Blackjack, deals, bounty awards and Vault payouts do not qualify.'},
  {id:'COMEBACK_KING',name:'Comeback King',description:'Finish first, including a tie, after a bottom-two balance position, including ties, among non-departed participants at a settled non-final round in the same match.'},
];

export function defaultMatchStats(playerId:string):MatchStats{return {playerId,blackjackWins:0,blackjackLosses:0,blackjackPushes:0,blackjackNet:0,bluffWins:0,bluffLosses:0,bluffNet:0,duelWins:0,duelLosses:0,duelDraws:0,duelNet:0,bountyAwarded:0,dealsPlayed:0,cooperations:0,loneSteals:0,dealNet:0,vaultWon:0,houseReigns:0,bountiesClaimed:0,vaultVictories:0};}
function award(p:Player,id:BadgeId,r:Room,eventId:string,description:string,now:number){
  if(!r.matchId||p.profile.badges.some(badge=>badge.id===id))return;
  p.profile.badges.push({id,earnedAt:now,evidence:{matchId:r.matchId,eventId,description}});
}

/** Rebuild from the authoritative hydrated before-state, so repeated evaluation is idempotent. */
export function updateAchievements(previous:Room,candidate:Room,now:number){
  const sameMatch=!!candidate.matchId&&previous.matchId===candidate.matchId;
  const previousBluffs=new Set(sameMatch?previous.bluffOutcomes.map(offer=>offer.id):[]);
  const newBluffs=candidate.matchId?candidate.bluffOutcomes.filter(offer=>offer.status==='accepted'&&!previousBluffs.has(offer.id)):[];
  const sameRound=sameMatch&&candidate.roundId===previous.roundId,oldPayouts=new Set(sameRound?previous.roundPayouts.map(payout=>payout.playerId):[]);
  const settledNonFinal=candidate.phase==='ROUND_RESULT'&&candidate.round>0&&candidate.round<candidate.roundLimit;
  const ranked=candidate.players.filter(p=>p.participating&&!p.departed).sort((a,b)=>a.account.balance-b.account.balance||a.seat-b.seat),bottomThreshold=ranked[Math.min(1,ranked.length-1)]?.account.balance;
  for(const p of candidate.players){
    const before=previous.players.find(player=>player.id===p.id),base=before?.profile??p.profile;
    p.profile.badges=structuredClone(base.badges);p.profile.acceptedBluffWins=Math.min(5,base.acceptedBluffWins+newBluffs.filter(offer=>offer.winnerId===p.id).length);
    p.profile.matchProgress=sameMatch&&base.matchProgress.matchId===candidate.matchId?structuredClone(base.matchProgress):{matchId:candidate.matchId??null,bottomTwo:false,bottomRoundId:null,lastSettledRoundId:null};
    p.matchStats=sameMatch&&before?{...before.matchStats}:defaultMatchStats(p.id);
    if(!candidate.matchId)continue;
    if(settledNonFinal&&p.participating&&!p.departed&&p.profile.matchProgress.lastSettledRoundId!==candidate.roundId){
      if(bottomThreshold!==undefined&&p.account.balance<=bottomThreshold){p.profile.matchProgress.bottomTwo=true;p.profile.matchProgress.bottomRoundId??=candidate.roundId!;}
      p.profile.matchProgress.lastSettledRoundId=candidate.roundId!;
    }
    for(const payout of candidate.roundPayouts.filter(payout=>payout.playerId===p.id&&!oldPayouts.has(payout.playerId))){
      p.matchStats.blackjackNet+=payout.profit;
      if(payout.profit>0)p.matchStats.blackjackWins++;else if(payout.profit<0)p.matchStats.blackjackLosses++;else p.matchStats.blackjackPushes++;
    }
    const offers=candidate.bluffOutcomes.filter(offer=>offer.status==='accepted'&&(offer.claimantId===p.id||offer.challengerId===p.id));
    p.matchStats.bluffWins=offers.filter(offer=>offer.winnerId===p.id).length;p.matchStats.bluffLosses=offers.length-p.matchStats.bluffWins;
    p.matchStats.bluffNet=offers.reduce((sum,offer)=>sum+(offer.winnerId===p.id?offer.amount:-offer.amount),0);
    const duels=candidate.party?.duelHistory.filter(duel=>duel.status==='settled'&&(duel.inviterId===p.id||duel.defenderId===p.id))??[];
    p.matchStats.duelWins=duels.filter(duel=>duel.winnerId===p.id).length;p.matchStats.duelLosses=duels.filter(duel=>duel.winnerId!==null&&duel.winnerId!==p.id).length;p.matchStats.duelDraws=duels.filter(duel=>duel.winnerId===null).length;
    p.matchStats.duelNet=duels.reduce((sum,duel)=>sum+(duel.winnerId===null?0:duel.winnerId===p.id?duel.amount:-duel.amount),0);
    const bountyAwards=candidate.party?.bounties.filter(bounty=>(bounty.status==='claimed'||bounty.status==='defeated')&&bounty.winnerId===p.id)??[];
    p.matchStats.bountyAwarded=bountyAwards.reduce((sum,bounty)=>sum+(bounty.status==='claimed'?bounty.total:Math.floor(85*bounty.total/100)),0);
    p.matchStats.bountiesClaimed=bountyAwards.length;
    p.matchStats.houseReigns=(candidate.party?.auction.status==='revealed'&&candidate.party.auction.winnerId===p.id?1:0)+(candidate.party?.overthrowHistory.filter(ballot=>ballot.status==='settled'&&ballot.winnerId===p.id&&ballot.challengerId===p.id&&ballot.houseId!==p.id).length??0);
    const deals=candidate.party?.dealHistory.filter(deal=>deal.status==='settled'&&(deal.inviterId===p.id||deal.defenderId===p.id))??[];
    p.matchStats.dealsPlayed=deals.length;p.matchStats.cooperations=deals.filter(deal=>deal.choices[deal.inviterId]==='SPLIT'&&deal.choices[deal.defenderId]==='SPLIT').length;
    const loneSteals=deals.filter(deal=>deal.choices[p.id]==='STEAL'&&deal.choices[p.id===deal.inviterId?deal.defenderId:deal.inviterId]==='SPLIT'&&deal.returns[p.id]===deal.amount*2);
    p.matchStats.loneSteals=loneSteals.length;p.matchStats.dealNet=deals.reduce((sum,deal)=>sum+deal.returns[p.id]!-deal.amount,0);
    p.matchStats.vaultWon=candidate.party?.transfers.filter(transfer=>(transfer.kind==='shadow_award'||transfer.kind==='vault_distribution')&&transfer.to===p.id).reduce((sum,transfer)=>sum+transfer.amount,0)??0;
    p.matchStats.vaultVictories=candidate.party?.shadow?.status==='settled'&&!candidate.party.shadow.fallback&&candidate.party.shadow.winnerIds.includes(p.id)&&candidate.party.shadow.awards.some(award=>award.playerId===p.id&&award.amount>0)?1:0;
    for(const ballot of candidate.party?.overthrowHistory??[])if(ballot.status==='settled'&&ballot.winnerId===p.id&&ballot.challengerId===p.id&&ballot.houseId!==p.id)award(p,'HOUSEBREAKER',candidate,ballot.id,'A resolved overthrow transferred the House crown to this player.',now);
    for(const bounty of bountyAwards)award(p,bounty.status==='claimed'?'UNTOUCHABLE':'BOUNTY_HUNTER',candidate,bounty.id,bounty.status==='claimed'?'Three qualifying consecutive defense wins claimed the complete funded bounty.':'Defeating the bounty target paid the funded challenger award.',now);
    if(p.profile.acceptedBluffWins>=5){const winning=newBluffs.findLast(offer=>offer.winnerId===p.id);if(winning)award(p,'MASTER_BLUFFER',candidate,winning.id,'This accepted Call My Bluff win reached five during the current guest session.',now);}
    for(const deal of loneSteals)award(p,'BETRAYER',candidate,deal.id,'A settled contract paid its complete pot to this player as the sole Steal choice.',now);
    for(const offer of offers)if(offer.winnerId===p.id&&(offer.pot??0)>=400)award(p,'HIGH_ROLLER',candidate,offer.id,`Won an accepted ${offer.pot}-chip Call My Bluff pot.`,now);
    for(const duel of duels)if(duel.winnerId===p.id&&duel.amount*2>=400)award(p,'HIGH_ROLLER',candidate,duel.id,`Won a funded ${duel.amount*2}-chip duel pot.`,now);
    const shadow=candidate.party?.shadow;if(shadow?.status==='settled'&&shadow.vaultThiefIds.includes(p.id))award(p,'VAULT_THIEF',candidate,shadow.id,'A false uncalled declaration changed the Vault winner set and increased this player’s actual award.',now);
    if(candidate.phase==='RESULTS'&&candidate.results?.winners.includes(p.id)&&p.profile.matchProgress.bottomTwo)award(p,'COMEBACK_KING',candidate,candidate.events.findLast(event=>event.kind==='results')?.id??`${candidate.matchId}:results`,'Finished first after a bottom-two balance position at a settled non-final round in this match.',now);
  }
}
export function projectMatchStats(r:Room):MatchStats[]{return r.players.filter(p=>p.participating).map(p=>({...p.matchStats}));}
