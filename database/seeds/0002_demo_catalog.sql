-- Demonstration catalog (app DB). Every row inserted here is tagged
-- data_provenance.source = 'demo_seed'. This is catalog data only: it inserts no orders,
-- payments, settlements or other business history.
-- Prices in INR. Supplier names are fictional.

INSERT IGNORE INTO supplier (supplier_id, supplier_name, phone, is_active) VALUES
(30,'Linden & Loom','0444000300',TRUE),
(40,'Atelier Brume','0114000400',TRUE);

INSERT IGNORE INTO supplier_certification (supplier_id, certification) VALUES
(30,'FSC'),(30,'GREENGUARD'),(40,'ISO9001'),(40,'BIFMA');
INSERT IGNORE INTO supplier_service_region (supplier_id, service_region) VALUES
(30,'Tamil Nadu'),(30,'Karnataka'),(40,'Delhi'),(40,'Maharashtra');

INSERT IGNORE INTO warranty_plan (plan_code, supplier_id, warranty_months) VALUES
('LINDEN24',30,24),('BRUME60',40,60);

INSERT IGNORE INTO product (product_id, product_name, supplier_id, list_price, is_active) VALUES
(103,'Walnut Sideboard',10,52000,TRUE),
(104,'Oak Bookcase Tower',10,29000,TRUE),
(105,'Cedar Platform Bed',10,74000,TRUE),
(203,'Bouclé Lounge Chair',20,34000,TRUE),
(204,'Travertine Coffee Table',20,41000,TRUE),
(205,'Ash Dining Bench',20,16500,TRUE),
(301,'Linen Upholstered Bed',30,82000,TRUE),
(302,'Rattan Bedside Table',30,9800,TRUE),
(303,'Wool Accent Armchair',30,27500,TRUE),
(304,'Sheesham Chest of Drawers',30,38500,TRUE),
(401,'Sit-Stand Studio Desk',40,58000,TRUE),
(402,'Mesh Task Chair',40,19500,TRUE),
(403,'Steel Filing Credenza',40,31000,TRUE),
(404,'Pendant Reading Lamp Table',40,12500,TRUE),
(405,'Modular Shelving System',40,46000,TRUE),
(206,'Marble Dining Table',20,96000,TRUE);

INSERT IGNORE INTO product_inventory (product_id, qty_on_hand, reorder_point, reorder_qty) VALUES
(103,5,2,4),(104,9,3,6),(105,3,2,3),(203,7,3,6),(204,4,2,4),(205,12,4,8),
(301,2,2,3),(302,20,6,12),(303,6,3,5),(304,4,2,4),
(401,6,3,6),(402,15,5,10),(403,3,2,4),(404,11,4,8),(405,5,2,4),(206,2,1,2);

INSERT INTO product_detail
(product_id, category_code, room, primary_material, style, description, width_cm, depth_cm, height_cm, model_key) VALUES
(101,'office','office','Oak','Executive','Solid white-oak executive desk with a floating top and concealed cable channel.',180,85,76,'desk'),
(102,'office','office','Oak','Ergonomic','Steam-bent oak frame with a contoured seat and lumbar support.',62,60,98,'chair'),
(201,'living','living','Fabric','Modular','Low modular sofa in a woven performance fabric; modules rearrange freely.',280,100,78,'sofa'),
(202,'dining','dining','Solid wood','Farmhouse','Six-seat dining table in solid acacia with a hand-oiled finish.',200,95,76,'table'),
(103,'storage','dining','Walnut','Mid-century','Four-door walnut sideboard on tapered legs with fluted fronts.',180,45,78,'sideboard'),
(104,'storage','office','Oak','Minimal','Tall open bookcase with adjustable oak shelves.',90,35,200,'bookcase'),
(105,'bedroom','bedroom','Cedar','Japandi','Low cedar platform bed with an integrated headboard ledge.',170,215,90,'bed'),
(203,'living','living','Bouclé','Organic','Rounded lounge chair upholstered in ivory bouclé.',82,80,74,'lounge_chair'),
(204,'living','living','Travertine','Sculptural','Honed travertine coffee table with a split pedestal base.',120,65,38,'coffee_table'),
(205,'dining','dining','Ash','Scandinavian','Solid ash bench seating three.',150,38,45,'bench'),
(206,'dining','dining','Marble','Contemporary','Calacatta-look marble top on a brushed brass base.',220,100,75,'table'),
(301,'bedroom','bedroom','Linen','Soft modern','Fully upholstered bed in stone-washed linen.',180,220,110,'bed'),
(302,'bedroom','bedroom','Rattan','Coastal','Woven rattan bedside table with a single drawer.',45,40,55,'nightstand'),
(303,'living','living','Wool','Classic','Wingback accent armchair in felted wool.',78,82,96,'armchair'),
(304,'storage','bedroom','Sheesham','Heritage','Six-drawer chest in solid sheesham with brass pulls.',120,48,95,'chest'),
(401,'office','office','Steel & oak','Studio','Electric sit-stand desk, oak veneer top, 70–120 cm range.',160,75,120,'desk'),
(402,'office','office','Mesh','Ergonomic','Breathable mesh task chair with 4D arms.',66,64,112,'chair'),
(403,'storage','office','Steel','Industrial','Powder-coated steel credenza with lateral filing drawers.',160,45,72,'credenza'),
(404,'living','studio','Oak','Minimal','Side table with an integrated dimmable reading lamp.',45,45,120,'side_table'),
(405,'storage','studio','Aluminium','Modular','Wall-mounted modular shelving with reconfigurable bays.',240,35,200,'shelving')
ON DUPLICATE KEY UPDATE description=VALUES(description);

INSERT IGNORE INTO product_variant (variant_id, product_id, variant_name, material, color_hex, price_delta) VALUES
(1011,101,'Natural Oak','Oak','#C8A27A',0),
(1012,101,'Smoked Oak','Oak','#6B4E3D',3500),
(1021,102,'Natural Oak / Oat Fabric','Oak','#D9C7B5',0),
(1022,102,'Natural Oak / Sage Fabric','Oak','#A8B09D',800),
(2011,201,'Oat Weave','Fabric','#D9C7B5',0),
(2012,201,'Clay Weave','Fabric','#B77D63',0),
(2013,201,'Sage Velvet','Velvet','#A8B09D',6000),
(2031,203,'Ivory Bouclé','Bouclé','#F5F1E9',0),
(2032,203,'Charcoal Bouclé','Bouclé','#373A34',1500);

INSERT IGNORE INTO product_variant_inventory (variant_id, qty_on_hand) VALUES
(1011,5),(1012,3),(1021,2),(1022,1),(2011,1),(2012,1),(2013,0),(2031,4),(2032,3);

INSERT IGNORE INTO data_provenance (entity_name, entity_key, source, note)
SELECT 'supplier', CAST(supplier_id AS CHAR), 'demo_seed', 'Fictional demo supplier' FROM supplier WHERE supplier_id IN (30,40)
UNION ALL
SELECT 'product', CAST(product_id AS CHAR), 'demo_seed', 'Demo catalog expansion' FROM product
 WHERE product_id NOT IN (101,102,201,202)
UNION ALL
SELECT 'warranty_plan', plan_code, 'demo_seed', 'Demo warranty plan' FROM warranty_plan WHERE plan_code IN ('LINDEN24','BRUME60');

-- Lab scenarios catalogue (definitions only; executions are recorded at runtime).
INSERT INTO demo_scenario (scenario_id, title, category, description, is_mutating) VALUES
('proc.confirm_order','Confirm a placed order','procedure','sp_confirm_order: status check, stock deduction, trigger-driven history and audit.',TRUE),
('proc.receive_goods','Post a goods receipt','procedure','sp_receive_goods: pending receipt increases inventory and is marked posted.',TRUE),
('proc.award_loyalty','Award loyalty points','procedure','sp_award_loyalty: FLOOR(total/100) points per delivered, unawarded order.',TRUE),
('proc.settlements','Build supplier settlements','procedure','sp_build_supplier_settlements: delivered totals per supplier, upserted per period.',TRUE),
('proc.reorders','Queue reorders','procedure','sp_queue_reorders: low-stock products upserted into reorder_request.',TRUE),
('trigger.status_flow','Order status state machine','trigger','bu_sales_order / au_sales_order transitions, history and audit rows.',TRUE),
('trigger.price_audit','Price-change auditing','trigger','au_product writes audit_log on list_price change.',TRUE),
('function.discount','Discounted price','function','fn_discounted_price with valid, NULL and out-of-range inputs.',FALSE),
('function.warranty','Warranty expiry','function','fn_warranty_expiry with valid, NULL and out-of-range inputs.',FALSE),
('tx.savepoint','Savepoints and rollback','transaction','START TRANSACTION, SAVEPOINT, ROLLBACK TO SAVEPOINT, COMMIT.',TRUE),
('concurrency.receipt_race','Double posting race (finding F1)','concurrency','Two sessions post the same receipt concurrently.',TRUE)
ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description);
