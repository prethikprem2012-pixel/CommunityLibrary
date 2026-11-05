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

  protected logout(): void {
    this.session.logout();
    this.router.navigateByUrl('/login');
  }
}
