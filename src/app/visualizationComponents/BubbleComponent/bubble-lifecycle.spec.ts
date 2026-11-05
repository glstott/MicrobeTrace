import { ElementRef } from '@angular/core';
import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { BubbleComponent } from './bubble.component';

describe('Bubble pane lifecycle', () => {
  let component: BubbleComponent;
  let renderer: jasmine.SpyObj<any>;
  let changeDetector: any;
  let container: any;

  beforeEach(() => {
    const common: any = { visuals: {}, session: { style: { widgets: {} } } };
    container = {
      width: 800, height: 600,
      on: jasmine.createSpy('on'), off: jasmine.createSpy('off'),
    };
    changeDetector = { detectChanges: jasmine.createSpy('detectChanges') };
    component = new BubbleComponent(common, container, new ElementRef(document.createElement('div')),
      changeDetector, { setNetworkRendered: jasmine.createSpy('setNetworkRendered') } as any, {} as any);
    renderer = jasmine.createSpyObj('renderer', ['fit', 'nodes', 'destroyed', 'removeAllListeners', 'destroy']);
    renderer.nodes.and.returnValue([]);
    renderer.destroyed.and.returnValue(false);
    component.cy = renderer;
    spyOn(component, 'onLabelSizeChange');
  });

  afterEach(() => component.ngOnDestroy());

  it('fits a live pane and refreshes labels after resizing', fakeAsync(() => {
    component.goldenLayoutComponentResize();
    tick(200);
    expect(renderer.fit).toHaveBeenCalled();
    expect(component.onLabelSizeChange).toHaveBeenCalled();
  }));

  it('cancels a pending resize when its pane is closed', fakeAsync(() => {
    component.goldenLayoutComponentResize();
    component.ngOnDestroy();
    tick(300);
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(renderer.fit).not.toHaveBeenCalled();
    expect(component.onLabelSizeChange).not.toHaveBeenCalled();
  }));

  it('ignores a late resize notification after destruction', fakeAsync(() => {
    component.ngOnDestroy();
    component.goldenLayoutComponentResize();
    tick(300);
    expect(changeDetector.detectChanges).not.toHaveBeenCalled();
    expect(renderer.fit).not.toHaveBeenCalled();
  }));

  it('can close before its pane event handlers have been registered', () => {
    container.off.and.throwError('No subscriptions to unsubscribe');
    expect(() => component.ngOnDestroy()).not.toThrow();
    expect(renderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not use a renderer destroyed before its resize callback runs', fakeAsync(() => {
    component.goldenLayoutComponentResize();
    renderer.destroyed.and.returnValue(true);
    tick(200);
    expect(renderer.fit).not.toHaveBeenCalled();
  }));

  it('does not create a renderer when its import completes after the pane closes', fakeAsync(() => {
    let finishImport: (factory: any) => void;
    const importedFactory = jasmine.createSpy('cytoscape factory');
    spyOn<any>(component, 'loadCytoscapeRenderer').and.returnValue(
      new Promise(resolve => { finishImport = resolve; }));
    component.cyContainer = new ElementRef(document.createElement('div'));
    component.ngAfterViewInit();
    component.ngOnDestroy();
    finishImport(importedFactory);
    flushMicrotasks();
    expect(importedFactory).not.toHaveBeenCalled();
    expect(component.cy).toBeNull();
  }));
});
