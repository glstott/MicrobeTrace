import cytoscape from 'cytoscape';
import { Subject } from 'rxjs';
import { TwoDComponent } from './visualizationComponents/TwoDComponent/twoD-plugin.component';
import { WaterfallComponent } from './visualizationComponents/WaterfallComponent/waterfall.component';

describe('Annotation targets from relationship selections', () => {
  it('maps selected mixed-source edge glyphs back to one loaded relationship', () => {
    const link = { id: 'stable-edge', source: 'A', target: 'B', origin: ['Genetic Distance', 'Contacts'] };
    const view: any = Object.create(TwoDComponent.prototype);
    Object.assign(view, {
      widgets: { 'link-color-variable': 'origin' }, sigmaActive: false,
      commonService: { session: { data: { links: [link] } }, hasInvestigationLayerStyle: () => false },
      getPerformanceNow: () => 0, recordTwoDRenderTiming: () => {},
      getRawLinkLabel: () => '', getLinkLabel: () => ({ text: '' }), getLinkColor: () => ({ color: '#123456', opacity: 1 }), getLinkWidth: () => 1,
    });
    const mapped = view.mapDataToCytoscapeElements({ nodes: [], links: [link] });
    view.cy = cytoscape({ headless: true, elements: [{ data: { id: 'A' } }, { data: { id: 'B' } }, ...mapped.edges] });
    try {
      view.cy.edges().select();
      expect(view.cy.edges(':selected').length).toBe(2);
      expect(view.getSelectedInvestigationEdgeIds()).toEqual(['stable-edge']);
      expect((link as any)._investigationEdgeId).toBeUndefined();
      view.commonService.session.data.links = [];
      expect(view.getSelectedInvestigationEdgeIds()).toEqual([]);
    } finally { view.cy.destroy(); }
    expect(view.getSelectedInvestigationEdgeIds()).toEqual([]);
  });

  it('uses a Waterfall relationship ID rather than its neighbor-node ID or row index', () => {
    const link = { id: 'edge-AB', source: 'A', target: 'B', distance: 1, index: 4 };
    const view: any = Object.create(WaterfallComponent.prototype);
    view.commonService = { session: { data: { links: [link] } } };
    view.getVisibleLinksForWaterfall = () => [link];
    view.selectedLinkRow = view.buildLinkTableData('A')[0];
    expect(view.selectedLinkRow.id).toBe('B');
    expect(view.getSelectedInvestigationEdgeIds()).toEqual(['edge-AB']);
    view.commonService.session.data.links = [];
    expect(view.getSelectedInvestigationEdgeIds()).toEqual([]);
    view.commonService.session.data.links = [link];
    view.destroy$ = new Subject<void>();
    view.ngOnDestroy();
    expect(view.getSelectedInvestigationEdgeIds()).toEqual([]);
  });
});
