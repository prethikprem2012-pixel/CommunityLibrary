import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth.guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'discover' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login-page/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'discover',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/discover-page/discover-page').then((m) => m.DiscoverPage),
  },
  {
    path: 'add-book',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/add-book-page/add-book-page').then((m) => m.AddBookPage),
  },
  {
    path: 'library',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/library-page/library-page').then((m) => m.LibraryPage),
  },
  {
    path: 'wallet',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/wallet-page/wallet-page').then((m) => m.WalletPage),
  },
  { path: '**', redirectTo: '' },
];
