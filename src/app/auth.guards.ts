import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.isLoggedIn() || inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return !session.isLoggedIn() || inject(Router).createUrlTree(['/discover']);
};
