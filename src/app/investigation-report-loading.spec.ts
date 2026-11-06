import { MicrobeTraceNextHomeComponent } from './microbe-trace-next-plugin.component';

describe('Investigation bundle loading with other panes open', () => {
  it('processes the dropped bundle and listens for launch on Files when Table precedes it', () => {
    const component: any = Object.create(MicrobeTraceNextHomeComponent.prototype);
    let launch: (value: string) => void;
    const nextSubscription = { unsubscribe: jasmine.createSpy('unsubscribe new') };
    const files = { LoadDefaultVisualizationEvent: { subscribe: jasmine.createSpy('subscribe').and.callFake(callback => {
      launch = callback; return nextSubscription;
    }) }, processFiles: jasmine.createSpy('process files'), populateTable: jasmine.createSpy('populate files') };
    const table = { processFiles: jasmine.createSpy('process table') };
    const previous = { unsubscribe: jasmine.createSpy('unsubscribe previous') };
    Object.assign(component, {
      commonService: { debugMode: false }, networkRendered: true, subscription: previous,
      homepageTabs: [{ label: 'Table', componentRef: { instance: table } }, { label: 'Files', componentRef: { instance: files } }],
      GlobalSettingsDialogSettings: { setVisibility: () => {} }, GlobalSettingsLinkColorDialogSettings: { setVisibility: () => {} },
      GlobalSettingsNodeColorDialogSettings: { setVisibility: () => {} },
      loadDefaultVisualization: jasmine.createSpy('launch visualization'), publishLoadNewData: jasmine.createSpy('publish data'),
    });
    const transfer = new DataTransfer(); transfer.items.add(new File(['synthetic bundle'], 'investigation.zip'));
    expect(() => component.getfileContent(transfer.files)).not.toThrow();
    expect(previous.unsubscribe).toHaveBeenCalledTimes(1);
    expect(files.processFiles).toHaveBeenCalledWith(transfer.files);
    expect(table.processFiles).not.toHaveBeenCalled();
    expect(component.subscription).toBe(nextSubscription);
    launch('2D Network');
    expect(component.loadDefaultVisualization).toHaveBeenCalledWith('2D Network');
    expect(component.publishLoadNewData).toHaveBeenCalledTimes(1);
  });
});
