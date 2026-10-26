import {RULES,DEALER_BET_MINIMUM,validBetAmount,type Command,type DealerBetView,type HouseBankView,type HouseRoundSettlement} from '@bluff-house/shared';
import {available,credit,reserve,release,commit,settle} from './ledger.js';
import {requireRule,type Room,type Player,type HouseBankState} from './state.js';

export function initialBank(r:Room):HouseBankState{return {dealerBet:{ownerId:null,id:null,roundId:null,amount:0,status:'NONE',returned:0,profit:0},initial:2*r.initialChips,balance:2*r.initialChips,liabilities:{},bond:{ownerId:null,amount:0,reservationId:null},rounds:[],bondHistory:[],dealerAutomated:false};}
function dealerBetOpen(r:Room){return ['BETTING','SHADOW_BETTING','POT_TWIST'].includes(r.phase);}
function dealerBetLive(r:Room){const bet=r.party?.bank.dealerBet;return !!bet&&bet.amount>0&&(bet.status==='RESERVED'||bet.status==='COMMITTED');}
/** The personal dealer stake never contributes to bettor payout backing. */
export function beginDealerBet(r:Room){const party=r.party;if(!party)return;const old=party.bank.dealerBet;if(old.roundId===r.roundId&&old.ownerId===party.houseId){ensureDealerBet(r);return;}requireRule(!dealerBetLive(r),'DEALER_BET_UNSETTLED');const owner=party.houseId?r.players.find(p=>p.id===party.houseId&&p.participating):undefined;party.bank.dealerBet={ownerId:owner?.id??null,id:owner?`${r.matchId}:${r.roundId}:${owner.id}:dealer-bet`:null,roundId:r.roundId??null,amount:0,status:'NONE',returned:0,profit:0};ensureDealerBet(r);}
export function ensureDealerBet(r:Room){const bet=r.party?.bank.dealerBet;if(!bet||!dealerBetOpen(r)||bet.status!=='NONE'||!bet.ownerId||r.terminationConfirmed)return;requireRule(bet.roundId===r.roundId&&bet.ownerId===r.party!.houseId&&bet.id,'STALE_DEALER_BET');const owner=r.players.find(p=>p.id===bet.ownerId)!;if(available(owner.account)<DEALER_BET_MINIMUM)return;reserve(owner.account,bet.id,DEALER_BET_MINIMUM);bet.amount=DEALER_BET_MINIMUM;bet.status='RESERVED';}
export function submitDealerBet(r:Room,p:Player,c:Command,now:number){
  requireRule(r.mode==='PARTY'&&r.party&&isHouse(r,p)&&p.connected&&!p.departed,'NOT_HOUSE');
  requireRule((r.phase==='BETTING'||r.phase==='SHADOW_BETTING')&&c.bettingId===r.bettingId&&c.roundId===r.roundId&&r.deadline!==null&&now<r.deadline&&!r.terminationConfirmed,'STALE_BETTING','Dealer betting is closed or the round has changed.');
  const bet=r.party.bank.dealerBet;requireRule(bet.ownerId===p.id&&bet.roundId===r.roundId&&bet.id&&(bet.status==='NONE'||bet.status==='RESERVED'),'STALE_DEALER_BET');
  const amount=c.payload?.amount;requireRule(typeof amount==='number'&&Number.isSafeInteger(amount)&&amount>=DEALER_BET_MINIMUM,'INVALID_DEALER_BET','The mandatory dealer wager is at least 10 whole chips.');
  reserve(p.account,bet.id,amount);bet.amount=amount;bet.status='RESERVED';
}
export function commitDealerBet(r:Room){const bet=r.party?.bank.dealerBet;if(!bet)return;ensureDealerBet(r);if(bet.status!=='RESERVED')return;requireRule(bet.roundId===r.roundId&&bet.ownerId&&bet.id,'STALE_DEALER_BET');const owner=r.players.find(p=>p.id===bet.ownerId)!;requireRule(owner.account.reservations[bet.id]===bet.amount,'DEALER_BET_RESERVATION_MISSING');commit(owner.account,bet.id);bet.status='COMMITTED';}
/** Only an undealt finale/round can refund a reserved stake without settling net. */
export function cancelDealerBet(r:Room){const bet=r.party?.bank.dealerBet;if(!bet||bet.status==='NONE'||bet.status==='SETTLED')return;requireRule(bet.status==='RESERVED'&&dealerBetOpen(r)&&r.terminationConfirmed,'DEALER_BET_REFUND_UNAVAILABLE');const owner=r.players.find(p=>p.id===bet.ownerId)!;release(owner.account,bet.id!);bet.status='SETTLED';bet.returned=bet.amount;bet.profit=0;}
export function projectDealerBet(r:Room):DealerBetView{const bet=r.party!.bank.dealerBet,owner=r.players.find(p=>p.id===bet.ownerId),reserved=owner&&bet.id?owner.account.reservations[bet.id]??0:0,committed=owner&&bet.id?owner.account.escrows[bet.id]??0:0;return {...bet,minimum:DEALER_BET_MINIMUM,maximum:owner?available(owner.account)+reserved:0,reserved,committed};}
export function isHouse(r:Room,p:Player|string):boolean{return !!r.party?.houseId&&r.party.houseId===(typeof p==='string'?p:p.id);}
export function liabilityKey(r:Room,p:Player){return p.wagerId??`${r.roundId}:${p.id}:blackjack`;}
export function bankCommitted(r:Room){return Object.values(r.party?.bank.liabilities??{}).reduce((sum,item)=>sum+item.amount,0);}
export function bankAvailable(r:Room){return r.party?r.party.bank.balance+r.party.bank.bond.amount-bankCommitted(r):RULES.maxBet;}
export function maximumBackedBet(r:Room,p:Player,includeCommitted=false){
  if(isHouse(r,p))return 0;
  const funds=available(p.account)+(p.wagerId?p.account.reservations[p.wagerId]??(includeCommitted?p.account.escrows[p.wagerId]??0:0):0);
  if(!r.party)return Math.min(funds,RULES.maxBet);
  const capacity=bankAvailable(r)+(r.party.bank.liabilities[liabilityKey(r,p)]?.amount??0);
  return Math.min(funds,RULES.maxBet,Math.floor((2*capacity+1)/3));
}
export function reserveLiability(r:Room,p:Player,stake:number){
  if(!r.party)return;requireRule(!isHouse(r,p),'HOUSE_CANNOT_BET','The House plays the dealer hand and cannot place an opposing wager.');
  requireRule(validBetAmount(stake),'INVALID_AMOUNT');
  const bank=r.party.bank,key=liabilityKey(r,p),amount=Math.floor(3*stake/2),previous=bank.liabilities[key];
  requireRule(!previous||previous.roundId===r.roundId,'STALE_LIABILITY');
  requireRule(amount<=bankAvailable(r)+(previous?.amount??0),'INSUFFICIENT_BANK_BACKING','The finite Table Bank cannot back that wager. Choose a smaller amount.');
  bank.liabilities[key]={playerId:p.id,roundId:r.roundId!,amount,committed:previous?.committed??false};
}
export function releaseLiability(r:Room,p:Player){if(r.party)delete r.party.bank.liabilities[liabilityKey(r,p)];}
export function commitLiability(r:Room,p:Player){if(r.party){const record=r.party.bank.liabilities[liabilityKey(r,p)];requireRule(record&&record.amount===Math.floor(3*p.wager/2),'MISSING_BANK_LIABILITY');record.committed=true;}}
export function releaseHouseBond(r:Room,id:string){
  const bank=r.party?.bank;if(!bank||!bank.bond.ownerId)return;
  requireRule(!dealerBetLive(r),'DEALER_BET_UNSETTLED');
  requireRule(bankCommitted(r)===0,'BOND_HAS_LIVE_LIABILITIES');
  requireRule(!bank.bondHistory.some(item=>item.id===id),'DUPLICATE_BOND_ID');
  const bond=bank.bond,player=r.players.find(p=>p.id===bond.ownerId)!;
  if(bond.reservationId)release(player.account,bond.reservationId);
  bank.bondHistory.push({id,kind:'release',ownerId:player.id,amount:bond.amount});bank.bond={ownerId:null,amount:0,reservationId:null};
}
export function takeHouseBond(r:Room,ownerId:string,id:string){
  const bank=r.party!.bank;requireRule(!bank.bond.ownerId,'BOND_ALREADY_HELD');
  requireRule(!dealerBetLive(r),'DEALER_BET_UNSETTLED');
  requireRule(bankCommitted(r)===0,'BOND_HAS_LIVE_LIABILITIES');
  requireRule(!bank.bondHistory.some(item=>item.id===id),'DUPLICATE_BOND_ID');
  const owner=r.players.find(p=>p.id===ownerId&&p.participating)!;requireRule(owner,'HOUSE_MISSING');
  const amount=Math.min(250,available(owner.account)),reservationId=`${r.matchId}:${id}:${ownerId}:house-bond`;
  if(amount)reserve(owner.account,reservationId,amount);
  bank.bond={ownerId,amount,reservationId};bank.bondHistory.push({id,kind:'entry',ownerId,amount});
}
/** Net all hands before distributing profit, so seat order cannot change earnings. */
export function settleBankRound(r:Room,losingStakes:number,winningProfits:number):HouseRoundSettlement|null{
  const party=r.party;if(!party)return null;const bank=party.bank,id=`${r.matchId}:${r.roundId}:bank-settlement`;
  requireRule([losingStakes,winningProfits].every(amount=>Number.isSafeInteger(amount)&&amount>=0),'INVALID_BANK_SETTLEMENT');
  const existing=bank.rounds.find(item=>item.id===id);if(existing){requireRule(existing.losingStakes===losingStakes&&existing.winningProfits===winningProfits,'SETTLEMENT_CONFLICT');return existing;}
  const bet=bank.dealerBet,stake=bet.roundId===r.roundId&&bet.ownerId?bet.amount:0;
  requireRule(!stake||bet.status==='COMMITTED','DEALER_BET_NOT_COMMITTED');
  const owner=bank.bond.ownerId?r.players.find(p=>p.id===bank.bond.ownerId):undefined;
  if(stake)requireRule(owner&&bet.ownerId===owner.id&&bet.id&&owner.account.escrows[bet.id]===stake,'DEALER_BET_ESCROW_MISSING');
  const net=losingStakes-winningProfits,stakeLoss=Math.min(Math.max(0,-net),stake);
  const record:HouseRoundSettlement={id,roundId:r.roundId!,houseId:party.houseId,payouts:r.roundPayouts.map(item=>({...item})),losingStakes,winningProfits,net,dealerStake:stake,dealerReturned:stake-stakeLoss,stakeLoss,dealerProfit:0,bondLoss:0,bankLoss:0,recovery:0,houseEarnings:0,bankEarnings:0};
  if(net<0){const remaining=-net-stakeLoss;record.bondLoss=Math.min(remaining,bank.bond.amount);record.bankLoss=remaining-record.bondLoss;requireRule(bank.balance>=record.bankLoss,'BANK_INSOLVENT');}
  else{record.recovery=Math.min(net,Math.max(0,bank.initial-bank.balance));const residual=net-record.recovery,priority=Math.min(stake,residual);record.houseEarnings=owner?priority+Math.floor((residual-priority)/2):0;record.bankEarnings=residual-record.houseEarnings;}
  record.dealerProfit=record.houseEarnings-record.stakeLoss;
  if(stake)requireRule(settle(owner!.account,bet.id!,record.dealerReturned),'DUPLICATE_DEALER_STAKE_RETURN');
  if(net<0){
    if(record.bondLoss){requireRule(owner&&bank.bond.reservationId,'HOUSE_BOND_MISSING');release(owner.account,bank.bond.reservationId);const lossId=`${id}:bond-loss`;reserve(owner.account,lossId,record.bondLoss);commit(owner.account,lossId);settle(owner.account,lossId,0);bank.bond.amount-=record.bondLoss;if(bank.bond.amount)reserve(owner.account,bank.bond.reservationId,bank.bond.amount);}
    bank.balance-=record.bankLoss;
  }else{bank.balance+=record.recovery+record.bankEarnings;if(owner&&record.houseEarnings){requireRule(credit(owner.account,`${id}:house-earnings`,record.houseEarnings),'DUPLICATE_HOUSE_EARNINGS');bank.bond.amount+=Math.min(record.houseEarnings,250-bank.bond.amount);if(bank.bond.amount)reserve(owner.account,bank.bond.reservationId!,bank.bond.amount);}}
  if(bet.ownerId&&bet.roundId===r.roundId){bet.status='SETTLED';bet.returned=record.dealerReturned;bet.profit=record.dealerProfit;}
  for(const [key,item] of Object.entries(bank.liabilities))if(item.roundId===r.roundId)delete bank.liabilities[key];
  bank.rounds.push(record);r.dealerNet=bank.initial-bank.balance;return record;
}
export function projectBank(r:Room):HouseBankView{const bank=r.party!.bank;return {dealerBet:projectDealerBet(r),initial:bank.initial,balance:bank.balance,available:bankAvailable(r),committed:bankCommitted(r),bond:{ownerId:bank.bond.ownerId,amount:bank.bond.amount},rounds:bank.rounds.map(item=>({...item,payouts:item.payouts.map(payout=>({...payout}))}))};}
export function validBondReservation(r:Room,p:Player,key:string){const bond=r.party?.bank.bond;return !!bond&&bond.ownerId===p.id&&bond.reservationId===key&&bond.amount>0&&p.account.reservations[key]===bond.amount;}
export function assertHouseBank(r:Room){
  const bank=r.party?.bank;if(!bank)return;
  requireRule(bank.initial===2*r.initialChips&&Number.isSafeInteger(bank.balance)&&bank.balance>=0&&r.dealerNet===bank.initial-bank.balance,'BANK_BALANCE_INVARIANT');
  requireRule(bankAvailable(r)>=0&&new Set(bank.rounds.map(item=>item.id)).size===bank.rounds.length&&new Set(bank.bondHistory.map(item=>item.id)).size===bank.bondHistory.length,'BANK_HISTORY_INVARIANT');
  const bond=bank.bond;requireRule(Number.isSafeInteger(bond.amount)&&bond.amount>=0&&bond.amount<=250,'BOND_AMOUNT_INVARIANT');
  if(bond.ownerId){const owner=r.players.find(p=>p.id===bond.ownerId);requireRule(owner&&bond.ownerId===r.party!.houseId&&bond.reservationId&&(bond.amount?owner.account.reservations[bond.reservationId]===bond.amount:!Object.hasOwn(owner.account.reservations,bond.reservationId)),'BOND_RESERVATION_INVARIANT');}
  else requireRule(bond.amount===0&&bond.reservationId===null,'RELEASED_BOND_INVARIANT');
  const bet=bank.dealerBet,betOwner=r.players.find(p=>p.id===bet.ownerId);
  requireRule(['NONE','RESERVED','COMMITTED','SETTLED'].includes(bet.status)&&Number.isSafeInteger(bet.amount)&&bet.amount>=0&&Number.isSafeInteger(bet.returned)&&bet.returned>=0&&bet.returned<=bet.amount&&Number.isSafeInteger(bet.profit),'DEALER_BET_STATE_INVARIANT');
  if(bet.ownerId)requireRule(betOwner?.participating&&bet.id&&bet.roundId,'DEALER_BET_OWNER_INVARIANT');else requireRule(bet.id===null&&bet.amount===0&&bet.status==='NONE'&&bet.returned===0&&bet.profit===0,'DEALER_BET_NONE_INVARIANT');
  if(dealerBetLive(r))requireRule(bet.ownerId===r.party!.houseId&&bet.roundId===r.roundId&&bet.amount>=DEALER_BET_MINIMUM&&bet.returned===0&&bet.profit===0,'LIVE_DEALER_BET_INVARIANT');
  if(bet.status==='RESERVED')requireRule(betOwner!.account.reservations[bet.id!]===bet.amount&&!Object.hasOwn(betOwner!.account.escrows,bet.id!)&&!Object.hasOwn(betOwner!.account.settlements,bet.id!),'DEALER_BET_RESERVATION_INVARIANT');
  if(bet.status==='COMMITTED')requireRule(betOwner!.account.escrows[bet.id!]===bet.amount&&!Object.hasOwn(betOwner!.account.reservations,bet.id!)&&!Object.hasOwn(betOwner!.account.settlements,bet.id!),'DEALER_BET_ESCROW_INVARIANT');
  if(bet.status==='NONE')requireRule(bet.amount===0,'DEALER_BET_NONE_INVARIANT');
  if(betOwner&&bet.status==='NONE'&&bet.roundId===r.roundId&&dealerBetOpen(r)&&!r.terminationConfirmed)requireRule(available(betOwner.account)<DEALER_BET_MINIMUM,'MANDATORY_DEALER_BET_MISSING');
  if(betOwner&&bet.id&&(bet.status==='NONE'||bet.status==='SETTLED'))requireRule(!Object.hasOwn(betOwner.account.reservations,bet.id)&&!Object.hasOwn(betOwner.account.escrows,bet.id),'CLOSED_DEALER_BET_INVARIANT');
  if(betOwner&&bet.status==='SETTLED'&&bet.amount&&bank.rounds.some(record=>record.roundId===bet.roundId))requireRule(betOwner.account.settlements[bet.id!]===bet.returned,'DEALER_BET_RETURN_INVARIANT');
  for(const p of r.players)for(const [kind,entries] of [['RESERVED',p.account.reservations],['COMMITTED',p.account.escrows]] as const)for(const key of Object.keys(entries))if(key.endsWith(':dealer-bet'))requireRule(bet.ownerId===p.id&&bet.id===key&&bet.status===kind&&entries[key]===bet.amount,'ORPHAN_DEALER_BET_INVARIANT');
  for(const p of r.players)for(const key of Object.keys(p.account.reservations))if(key.endsWith(':house-bond'))requireRule(validBondReservation(r,p,key),'ORPHAN_BOND_INVARIANT');
  for(const p of r.players)if(p.wagerId&&(Object.hasOwn(p.account.reservations,p.wagerId)||Object.hasOwn(p.account.escrows,p.wagerId)))requireRule(!!bank.liabilities[p.wagerId],'UNBACKED_WAGER_INVARIANT');
  for(const [key,item] of Object.entries(bank.liabilities)){const p=r.players.find(p=>p.id===item.playerId);requireRule(p&&!isHouse(r,p)&&p.wagerId===key&&item.roundId===r.roundId&&item.amount===Math.floor(3*p.wager/2)&&item.committed===Object.hasOwn(p.account.escrows,key),'BANK_LIABILITY_INVARIANT');}
  for(const item of bank.rounds)requireRule(item.net===item.losingStakes-item.winningProfits&&[item.losingStakes,item.winningProfits,item.dealerStake,item.dealerReturned,item.stakeLoss,item.bondLoss,item.bankLoss,item.recovery,item.houseEarnings,item.bankEarnings].every(n=>Number.isSafeInteger(n)&&n>=0)&&item.dealerReturned+item.stakeLoss===item.dealerStake&&Number.isSafeInteger(item.dealerProfit)&&item.dealerProfit===item.houseEarnings-item.stakeLoss&&(item.net<0?-item.net===item.stakeLoss+item.bondLoss+item.bankLoss:item.net===item.recovery+item.houseEarnings+item.bankEarnings),'BANK_SETTLEMENT_INVARIANT');
  for(const item of bank.rounds)if(item.payouts.length)requireRule(item.losingStakes===item.payouts.reduce((sum,p)=>sum+Math.max(0,-p.profit),0)&&item.winningProfits===item.payouts.reduce((sum,p)=>sum+Math.max(0,p.profit),0)&&item.payouts.every(p=>Number.isSafeInteger(p.stake)&&p.stake>0&&Number.isSafeInteger(p.returned)&&p.returned>=0&&p.profit===p.returned-p.stake&&p.houseCommission===0),'BANK_PAYOUT_HISTORY_INVARIANT');
}
