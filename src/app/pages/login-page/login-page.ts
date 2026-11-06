import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionService } from '../../session.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.html',
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  protected login(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const { email: userId, password } = this.form.getRawValue();
    const error = this.session.login(userId, password);
    if (error) return;
    this.router.navigateByUrl('/discover');
  }
}
