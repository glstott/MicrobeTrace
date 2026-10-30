/// <reference types="cypress" />

/** Open optional authoring controls when the workspace presents them collapsed. */
export function expandInvestigationTools(): void {
  cy.get('[data-testid="investigation-panel"]').then($panel => {
    // Older workspace layouts already expose the tools. Native disclosures are
    // opened through their visible summaries, including the outer Optional tools.
    $panel.find('details').toArray().forEach(detail => {
      if (!(detail as HTMLDetailsElement).open) cy.wrap(detail).children('summary').click();
    });
  });
  cy.get('[aria-label="New cohort name"]').scrollIntoView();
}
