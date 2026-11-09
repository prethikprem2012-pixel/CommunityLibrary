import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from './session.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  protected readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    try {
      await this.session.logout();
      await this.router.navigateByUrl('/login');
    } catch {
      // SessionService exposes the failure through authError.
    }
  }
}
