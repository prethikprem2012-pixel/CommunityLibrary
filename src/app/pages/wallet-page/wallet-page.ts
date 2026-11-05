import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CreditsService } from '../../credits.service';
import {
  BORROW_COST_AMOUNT,
  CO2_SAVED_KG,
  LEND_REWARD_AMOUNT,
  LedgerEntry,
  PEER_TRUST_SCORE,
  PAPER_CONSERVED_KG,
  TOTAL_MONEY_SAVED,
  TREES_SAVED,
  WATER_CONSERVED_L,
} from '../../credit.models';

@Component({
  selector: 'app-wallet-page',
  imports: [DatePipe],
  templateUrl: './wallet-page.html',
})
export class WalletPage {
  protected readonly credits = inject(CreditsService);

  protected readonly lendReward = LEND_REWARD_AMOUNT;
  protected readonly borrowCost = BORROW_COST_AMOUNT;
  protected readonly totalSaved = TOTAL_MONEY_SAVED;
  protected readonly paperConserved = PAPER_CONSERVED_KG;
  protected readonly trustScore = PEER_TRUST_SCORE;
  protected readonly co2Saved = CO2_SAVED_KG;
  protected readonly treesSaved = TREES_SAVED;
  protected readonly waterConserved = WATER_CONSERVED_L;

  protected amountClass(amount: number): string {
    return amount >= 0 ? 'text-emerald-600' : 'text-amber-700';
  }

  protected sign(amount: number): string {
    return amount >= 0 ? '+' : '';
  }

  protected entryIcon(type: LedgerEntry['type']): string {
    switch (type) {
      case 'lend':
        return 'lend';
      case 'borrow':
        return 'borrow';
      default:
        return 'grant';
    }
  }

  protected entryIconBg(type: LedgerEntry['type']): string {
    switch (type) {
      case 'lend':
        return 'bg-emerald-100 text-emerald-700';
      case 'borrow':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-sky-100 text-sky-700';
    }
  }
}
