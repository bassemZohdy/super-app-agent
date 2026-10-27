import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { FocusedWorkspaceComponent } from './app/focused-workspace.component.js';

bootstrapApplication(location.pathname.replace(/\/$/, '') === '/services/fines' ? FocusedWorkspaceComponent : AppComponent).catch(() => console.error('The Cityside shell could not start.'));
